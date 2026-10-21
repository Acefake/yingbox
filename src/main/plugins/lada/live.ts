/**
 * 「边跑边看」：lada 一边处理，播放器一边跟着播。
 *
 * 为什么这么做（都来自实测）：
 *  - mpv 的 A/V 同步以**音频为主时钟**（--video-sync 默认 audio）。如果只把原片当
 *    外挂音轨挂着，音频会跑到视频前面，越看越不同步。
 *  - 所以每个分片都**自带音视频同一区间**，音频在结构上不可能跑在视频前面；
 *    实测整段跟播的音画漂移只有 0.02–0.03 秒。
 *  - mpv 会跟着"增长了的事件型播放列表"连续播下去，不需要任何 seek 补丁。
 * 切分片 / 播放列表 / HTTP 服务见 live-media.ts。
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { LadaJob, LadaLiveStatus } from '../../../shared/lada'
import { lada } from '../../../shared/contract/lada'
import { emit } from '../../rpc'
import { registerPlugin } from '../host'
import { cancelCurrentJob, currentJob, startJob, waitForLadaExit } from './job'
import { type LiveSession, cutSegment, probeSegment, serve, writePlaylist } from './live-media'
import { adoptPartial } from './resume'
import { SEGMENT_SECONDS, segmentVerdict } from './rules'
import { ladaTempVideo, tempDirPath } from './temp'
import { ffprobeFor, ladaPaths } from './tools'

/** 切不出完整分片时的重试间隔 */
const RETRY_MS = 2500
/** 等首片出现的上限（含模型加载约 30 秒） */
const FIRST_SEGMENT_TIMEOUT_MS = 240_000

let session: LiveSession | null = null

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** 一轮追播：能切就切，不能切就等。**任何异常都不能让链断掉** */
async function tick(): Promise<void> {
  try {
    await tickOnce()
  } catch (error) {
    const s = session
    if (!s || s.stopping) return
    s.error = error instanceof Error ? error.message : String(error)
    console.error('[lada-live] 追播出错，继续重试：', error)
    schedule(RETRY_MS)
  }
}

async function tickOnce(): Promise<void> {
  const s = session
  if (!s || s.stopping || s.state === 'finished' || s.state === 'failed') return
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) {
    s.state = 'failed'
    s.error = '没找到 ffmpeg，无法切分片'
    return
  }
  const ffprobe = ffprobeFor(ffmpeg)
  const job = currentJob()
  const ladaRunning = job?.state === 'running'
  const waitOrFinish = (): void => (ladaRunning ? schedule(RETRY_MS) : finishUp())

  const start = s.nextStart
  const name = await cutSegment(s, ffmpeg, ffprobe, s.segments.length, start, start + SEGMENT_SECONDS)
  // 数据还不够切满一段：lada 还在跑就等；已经结束了就直接收尾
  if (!name) return waitOrFinish()

  const segment = join(s.workDir, name)
  const info = await probeSegment(ffprobe, segment)
  if (!info) {
    rmSync(segment, { force: true })
    return waitOrFinish()
  }

  // 数据不足时 -c copy 只会切出很短的一截，丢掉等下一轮（不猜"写到哪里了"）
  const verdict = segmentVerdict(info.duration, ladaRunning)
  if (verdict !== 'publish') {
    rmSync(segment, { force: true })
    return verdict === 'retry' ? schedule(RETRY_MS) : finishUp()
  }

  s.segments.push({ name, duration: info.duration })
  s.nextStart = info.start + info.duration
  writePlaylist(s, false)
  broadcastStatus(s)
  return schedule(ladaRunning ? 800 : 300)
}

function finishUp(): void {
  const s = session
  if (!s) return
  writePlaylist(s, true)
  s.state = 'finished'
  broadcastStatus(s)
}

function schedule(ms: number): void {
  const s = session
  if (!s || s.stopping) return
  s.timer = setTimeout(() => { void tick() }, ms)
}

function statusOf(s: LiveSession): LadaLiveStatus {
  return {
    state: s.state,
    input: s.input,
    url: s.port ? `http://127.0.0.1:${s.port}/index.m3u8` : '',
    segments: s.segments.length,
    availableSeconds: Math.max(0, Math.round(s.nextStart)),
    ...(s.error ? { error: s.error } : {}),
  }
}

function broadcastStatus(s: LiveSession): void {
  emit(lada, 'live', statusOf(s))
}

/**
 * 「边跑边看」的入口。语义（按用户要求）：
 *  - 正在追播的就是这部片子 → 不报错，直接把地址再交给播放器（接着看）
 *  - 有**别的**追播会话 → 先把老的「暂停」：停 lada + 把半成品登记成可续跑的进度，再开新的
 *  - 已经有一个**普通去码任务**在跑同一部片子 → 直接追播它，不再起第二个 lada
 *  - 有别的普通任务在跑 → 同样先暂停并登记进度
 */
export async function startLive(input: unknown): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    if (typeof input !== 'string' || !input.trim()) throw new Error('缺少文件路径')
    const file = input.trim()

    // 1) 正在追播的就是它：直接复用地址，别报"已有一个"
    if (session && session.input === file && session.state !== 'cancelled') {
      if (session.segments.length > 0) return { success: true, url: statusOf(session).url }
      return await waitForFirstSegment(session)
    }

    // 2) 有别的追播会话：先暂停它（停 lada + 把半成品登记成可续跑进度）
    if (session) await pauseSession(session)

    // 3) 已经有一个普通去码任务在跑同一部片子：直接追播它，不另起 lada
    const existing = currentJob()
    let job: LadaJob
    if (existing && existing.state === 'running' && existing.input === file) {
      job = existing
    } else {
      if (existing && existing.state === 'running') await pauseJob(existing)
      job = startJob(file)
    }

    const workDir = join(tempDirPath(), 'live', String(job.startedAt))
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })

    const live: LiveSession = {
      input: file, output: job.output, tempVideo: ladaTempVideo(job.output), workDir,
      playlist: join(workDir, 'index.m3u8'),
      segments: [], nextStart: 0, port: 0,
      state: 'preparing', server: null, stopping: false,
    }
    session = live
    live.port = await serve(live)
    broadcastStatus(live)
    void tick()
    return await waitForFirstSegment(live)
  } catch (error) {
    stopLive()
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 等首批分片出现再交给播放器：空播放列表播不了 */
async function waitForFirstSegment(live: LiveSession): Promise<{ success: boolean; url?: string; error?: string }> {
  const deadline = Date.now() + FIRST_SEGMENT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (live.segments.length > 0) {
      live.state = 'serving'
      broadcastStatus(live)
      return { success: true, url: statusOf(live).url }
    }
    if (live.state === 'failed') throw new Error(live.error || '追播启动失败')
    const job = currentJob()
    if (job && job.input === live.input && job.state !== 'running') {
      throw new Error(job.error || 'lada 已停止，无法继续')
    }
    await sleep(500)
  }
  throw new Error('等待首个分片超时')
}

/** 暂停一个追播会话：收掉播放视图；它对应的 lada 任务若还在跑，则停下并登记进度 */
async function pauseSession(target: LiveSession): Promise<void> {
  const job = currentJob()
  if (job && job.state === 'running' && job.input === target.input) {
    await pauseJob(job)
  }
  stopLive()
}

/** 暂停一个去码任务：先把半成品抢下来，停下 lada，再登记成可续跑的进度 */
async function pauseJob(job: LadaJob): Promise<void> {
  const partial = ladaTempVideo(job.output)
  // 必须**先**复制：取消任务时主进程会把 lada 的临时文件清掉，
  // 等它结束再去找就只剩空气了（等于这一段白跑）
  const staged = `${partial}.pause-${Date.now()}`
  let stagedOk = false
  try {
    if (existsSync(partial)) {
      copyFileSync(partial, staged)
      stagedOk = true
    }
  } catch {
    /* 复制不出来就只能放弃这次的进度 */
  }
  cancelCurrentJob()
  if (stagedOk) {
    // 先把进度登记好（副本已经抢在杀进程之前拷出来了）
    await adoptPartial(job.input, staged).catch(() => null)
    rmSync(staged, { force: true })
  }
  // 关键：必须等 lada **真的**退出再让调用方往下走（去起新任务）。
  // 否则新 lada 会和还在收尾的旧 lada 抢显存，两个一起死。
  await waitForLadaExit()
}

export function stopLive(): void {
  const s = session
  if (!s) return
  s.stopping = true
  if (s.timer) clearTimeout(s.timer)
  if (s.state === 'serving' || s.state === 'preparing') s.state = 'cancelled'
  try {
    s.server?.close()
  } catch {
    /* ignore */
  }
  // 只清分片，lada 的半成品留给 lada/清扫逻辑处理
  rmSync(s.workDir, { recursive: true, force: true })
  broadcastStatus(s)
  session = null
}

/** 边跑边看的当前状态；没有会话时为 null */
export function liveStatus(): LadaLiveStatus | null {
  return session ? statusOf(session) : null
}

/** 登记为插件：退出时由插件宿主停掉追播会话 */
export function initLadaLive(): void {
  registerPlugin({
    id: 'lada-live',
    stop: () => stopLive(),
    health: () => ({ running: session !== null, detail: session?.state }),
  })
}
