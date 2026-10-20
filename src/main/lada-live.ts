/**
 * 「边跑边看」：lada 一边处理，播放器一边跟着播。
 *
 * 为什么这么做（都来自实测）：
 *  - mpv 的 A/V 同步以**音频为主时钟**（--video-sync 默认 audio）。如果只把原片当
 *    外挂音轨挂着，音频会跑到视频前面，越看越不同步。
 *  - 所以每个分片都**自带音视频同一区间**，音频在结构上不可能跑在视频前面；
 *    实测整段跟播的音画漂移只有 0.02–0.03 秒。
 *  - mpv 会跟着"增长了的事件型播放列表"连续播下去，不需要任何 seek 补丁。
 *
 * 三个坑（也都实测踩过）：
 *  1. 播放列表必须标 #EXT-X-PLAYLIST-TYPE:EVENT，并且**原子写**（否则播放器会读到半截）
 *  2. 分片时间戳必须**连续**（用 -copyts），一旦每个分片从 0 开始就会反复播同一段
 *  3. 本地文件路径的 HLS 在 Windows 上走不通 → 起一个只绑 127.0.0.1 的 HTTP 服务
 */
import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { cancelCurrentJob, currentJob, ladaPaths, ladaTempVideo, startJob, waitForLadaExit } from './lada'
import { adoptPartial } from './lada-resume'
import type { LadaJob, LadaLiveState, LadaLiveStatus } from '../shared/lada'

/** 每个分片的秒数。够小才能尽快出画，够大才不至于切得太碎 */
const SEGMENT_SECONDS = 10
/** 切不出完整分片时的重试间隔 */
const RETRY_MS = 2500
/** 等首片出现的上限（含模型加载约 30 秒） */
const FIRST_SEGMENT_TIMEOUT_MS = 240_000

interface LiveSession {
  input: string
  output: string
  tempVideo: string
  workDir: string
  playlist: string
  /** 已发布的分片：名字 + **实测**时长（EXTINF 必须写实测值，不能写请求值） */
  segments: { name: string; duration: number }[]
  nextStart: number
  port: number
  state: LadaLiveState
  error?: string
  server: Server
  timer?: ReturnType<typeof setTimeout>
  stopping: boolean
}

let session: LiveSession | null = null

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function run(bin: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.once('error', () => resolve({ code: -1, out }))
    child.once('exit', code => resolve({ code: code ?? -1, out }))
  })
}

/** 与 ffmpeg 同目录的 ffprobe；找不到就退回 PATH 上的 ffprobe */
function ffprobeFor(ffmpeg: string): string {
  if (ffmpeg && ffmpeg !== 'ffmpeg') {
    const sibling = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (existsSync(sibling)) return sibling
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

/** 读取一段媒体的起始时间与时长（用来判断分片是否切全、以及推进游标） */
async function probeSegment(
  ffprobe: string,
  file: string
): Promise<{ start: number; duration: number } | null> {
  const { code, out } = await run(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=start_time,duration',
    '-of', 'default=noprint_wrappers=1',
    file,
  ])
  if (code !== 0) return null
  const start = Number((out.match(/start_time=([\d.]+)/) || [])[1] ?? NaN)
  const duration = Number((out.match(/duration=([\d.]+)/) || [])[1] ?? NaN)
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null
  return { start, duration }
}

/** 原子写播放列表：EVENT 表示"只增不减"，正是边处理边看的语义 */
function writePlaylist(s: LiveSession, ended: boolean): void {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 2}`,
    '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:EVENT']
  for (const seg of s.segments) {
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`)
    lines.push(seg.name)
  }
  if (ended) lines.push('#EXT-X-ENDLIST')
  const body = `${lines.join('\n')}\n`
  // 播放器正在轮询这个文件时，Windows 上 rename 可能被拒（EBUSY/EPERM）→ 重试，
  // 最后一次退化为直接覆写。绝不能因为写播放列表失败就把追播链断掉。
  const tmp = `${s.playlist}.tmp`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeFileSync(tmp, body)
      renameSync(tmp, s.playlist)
      return
    } catch {
      // 稍后重试
    }
  }
  try {
    rmSync(tmp, { force: true })
  } catch {
    /* ignore */
  }
  writeFileSync(s.playlist, body)
}

/**
 * 切一个分片。分两趟走：
 *   1) 只从"增长中的半成品"切视频 —— 但 `-c copy` 只能落在关键帧上，实际起点会往后偏
 *   2) 用**实测出来的真实起点/时长**去原片切音频，再封装
 * 这样音频严格跟随视频的实际区间，而不是"我请求的区间"——否则每个分片内音画会差
 * 最多一个 GOP（实测能看到 0.2 秒级偏移）。
 * `-copyts` 保持时间戳连续，避免播放器反复播同一段。
 */
async function cutSegment(
  s: LiveSession,
  ffmpeg: string,
  ffprobe: string,
  index: number,
  start: number,
  end: number
): Promise<string | null> {
  const name = `seg${String(index).padStart(5, '0')}.ts`
  const file = join(s.workDir, name)
  const videoOnly = join(s.workDir, `${name}.v.ts`)
  rmSync(file, { force: true })
  rmSync(videoOnly, { force: true })

  const cut = await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', s.tempVideo,
    '-an', '-c', 'copy', '-copyts',
    '-f', 'mpegts', videoOnly,
  ])
  if (cut.code !== 0 || !existsSync(videoOnly) || statSync(videoOnly).size < 8 * 1024) {
    rmSync(videoOnly, { force: true })
    return null
  }
  const info = await probeSegment(ffprobe, videoOnly)
  if (!info) {
    rmSync(videoOnly, { force: true })
    return null
  }

  const audioTo = info.start + info.duration
  const mux = await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-ss', info.start.toFixed(3), '-to', audioTo.toFixed(3), '-i', s.input,
    '-i', videoOnly,
    '-map', '1:v:0', '-map', '0:a:0',
    '-c', 'copy', '-copyts',
    '-f', 'mpegts', file,
  ])
  rmSync(videoOnly, { force: true })
  if (mux.code !== 0 || !existsSync(file) || statSync(file).size < 8 * 1024) {
    rmSync(file, { force: true })
    return null
  }
  return name
}

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

  const start = s.nextStart
  const end = start + SEGMENT_SECONDS
  const name = await cutSegment(s, ffmpeg, ffprobe, s.segments.length, start, end)

  if (!name) {
    // 数据还不够切满一段：lada 还在跑就等；已经结束了就直接收尾
    if (ladaRunning) return schedule(RETRY_MS)
    return finishUp()
  }

  const info = await probeSegment(ffprobe, join(s.workDir, name))
  if (!info) {
    rmSync(join(s.workDir, name), { force: true })
    return ladaRunning ? schedule(RETRY_MS) : finishUp()
  }

  // 数据不足时 -c copy 只会切出很短的一截，丢掉等下一轮（不猜"写到哪里了"）
  if (info.duration < SEGMENT_SECONDS * 0.95) {
    if (ladaRunning) {
      rmSync(join(s.workDir, name), { force: true })
      return schedule(RETRY_MS)
    }
    // lada 已结束，这段就是片尾：短点也收下
    if (info.duration < 0.5) {
      rmSync(join(s.workDir, name), { force: true })
      return finishUp()
    }
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
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('lada:live', statusOf(s))
  }
}

function serve(s: LiveSession): Promise<number> {
  s.server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '')
    // Node 的 res.end() 返回 this，直接 return 会触发 "not all code paths return a value"
    if (name && !/^[A-Za-z0-9._-]+$/.test(name)) {
      res.statusCode = 400
      res.end()
      return
    }
    const file = join(s.workDir, name || 'index.m3u8')
    if (!file.startsWith(s.workDir) || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise(resolve => {
    s.server.listen(0, '127.0.0.1', () => {
      const address = s.server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

/**
 * 「边跑边看」的入口。语义（按用户要求）：
 *  - 正在追播的就是这部片子 → 不报错，直接把地址再交给播放器（接着看）
 *  - 有**别的**追播会话 → 先把老的「暂停」：停 lada + 把半成品登记成可续跑的进度，再开新的
 *  - 已经有一个**普通去码任务**在跑同一部片子 → 直接追播它，不再起第二个 lada
 *  - 有别的普通任务在跑 → 同样先暂停并登记进度
 */
async function startLive(input: unknown): Promise<{ success: boolean; url?: string; error?: string }> {
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

    const tempVideo = ladaTempVideo(job.output)
    const workDir = join(app.getPath('temp'), 'yingbox-lada', 'live', String(job.startedAt))
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })

    const live: LiveSession = {
      input: file, output: job.output, tempVideo, workDir,
      playlist: join(workDir, 'index.m3u8'),
      segments: [], nextStart: 0, port: 0,
      state: 'preparing', server: null as unknown as Server, stopping: false, /* eslint-disable-line */
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

function stopLive(): void {
  const s = session
  if (!s) return
  s.stopping = true
  if (s.timer) clearTimeout(s.timer)
  if (s.state === 'serving' || s.state === 'preparing') s.state = 'cancelled'
  try {
    s.server.close()
  } catch {
    /* ignore */
  }
  // 只清分片，lada 的半成品留给 lada/清扫逻辑处理
  rmSync(s.workDir, { recursive: true, force: true })
  broadcastStatus(s)
  session = null
}

export function registerLadaLiveIpc(): void {
  ipcMain.handle('lada:startLive', (_e, input: unknown) => startLive(input))
  ipcMain.handle('lada:stopLive', () => {
    stopLive()
    return { success: true }
  })
  ipcMain.handle('lada:liveStatus', () => (session ? statusOf(session) : null))
  app.on('before-quit', () => stopLive())
}
