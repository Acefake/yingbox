/**
 * 去码的「暂停 / 继续」（缓存 + 续跑）。
 *
 * 背景：lada 命令行**没有**续跑选项，只能整片跑。所以续跑由影盒实现：
 *   1. 每处理一段就把**已完成秒数**记进进度文件，并把那段修复好的视频留在缓存目录
 *   2. 「继续」时把源片从已完成秒数处裁出剩余部分（-c copy，很快），只让 lada 处理剩余
 *   3. 剩余部分跑完后，把各段拼起来，再从原片补上音轨，产出最终的 .restored.mp4
 *
 * 代价：段边界可能有一帧级瑕疵；分段处理的时域稳定性略逊于整片一次跑。
 */
import { app } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ladaPaths, onJobFinished, startJob, tempDirPath } from './lada'
import { emit } from './rpc'
import { lada } from '../shared/contract/lada'
import { type LadaResumeProgress, restoredPathFor } from '../shared/lada'

interface Running {
  input: string
  output: string
  remainder: string
  trimStart: number
}

let running: Running | null = null

const cacheRoot = (): string => join(app.getPath('userData'), 'lada-cache')
const keyFor = (input: string): string =>
  createHash('sha1').update(input.toLowerCase()).digest('hex').slice(0, 16)
const dirFor = (input: string): string => join(cacheRoot(), keyFor(input))
const partPath = (input: string, index: number): string => join(dirFor(input), `part${index}.mp4`)
const progressPath = (input: string): string => join(dirFor(input), 'progress.json')

export function readProgress(input: string): LadaResumeProgress | null {
  const file = progressPath(input)
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as LadaResumeProgress
    if (!data || typeof data.doneSeconds !== 'number' || data.doneSeconds <= 1) return null
    return { ...data, input }
  } catch {
    return null
  }
}

function writeProgress(progress: LadaResumeProgress): void {
  const dir = dirFor(progress.input)
  mkdirSync(dir, { recursive: true })
  const file = progressPath(progress.input)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(progress, null, 2))
  renameSync(tmp, file)
}

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

function ffprobeFor(ffmpeg: string): string {
  if (ffmpeg && ffmpeg !== 'ffmpeg') {
    const sibling = join(ffmpeg, '..', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (existsSync(sibling)) return sibling
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

async function durationOf(ffprobe: string, file: string): Promise<number | null> {
  const { code, out } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1', file])
  if (code !== 0) return null
  const value = Number((out.match(/duration=([\d.]+)/) || [])[1] ?? NaN)
  return Number.isFinite(value) && value > 0 ? value : null
}

function partsOf(input: string): string[] {
  const dir = dirFor(input)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(n => /^part\d+\.mp4$/.test(n))
    .sort((a, b) => Number(a.slice(4, -4)) - Number(b.slice(4, -4)))
    .map(n => join(dir, n))
}

/**
 * 把一份"半成品"视频收进缓存目录当作最新的一段，并更新进度。
 * 用于接管 lada 自己写在 %TEMP% 里的临时文件（比如上次被中断的那个）。
 */
export async function adoptPartial(input: string, partialFile: string): Promise<LadaResumeProgress | null> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) return null
  const ffprobe = ffprobeFor(ffmpeg)
  if (!existsSync(partialFile)) return null
  const done = await durationOf(ffprobe, partialFile)
  if (!done || done < 2) return null
  mkdirSync(dirFor(input), { recursive: true })
  const existing = partsOf(input)
  const target = partPath(input, existing.length)
  try {
    copyFileSync(partialFile, target)
  } catch {
    return null
  }
  const progress: LadaResumeProgress = {
    input,
    doneSeconds: done,
    parts: existing.length + 1,
    preset: 'hevc-nvidia-gpu-hq',
    updatedAt: Date.now(),
  }
  writeProgress(progress)
  return progress
}

/** 剩余部分跑完后：拼段 + 补音轨 → 最终 .restored.mp4 */
async function assemble(input: string, output: string): Promise<void> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) throw new Error('没找到 ffmpeg')
  const dir = dirFor(input)
  const parts = partsOf(input)
  if (!parts.length) throw new Error('没有可拼接的分段')

  // 各段先转成 MPEG-TS 再拼。TS 用统一的 90kHz 时间基，能容忍各段 time_base
  // 不同；直接 concat mp4 在 time_base 不一致时会算错时长（实测 40 秒拼出 77 秒）。
  // 只取视频轨——音轨最后统一从原片补，避免"有的段有音轨、有的没有"。
  const tsFiles: string[] = []
  for (const part of parts) {
    const ts = `${part}.ts`
    rmSync(ts, { force: true })
    const convert = await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', part,
      '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'hevc_mp4toannexb', '-f', 'mpegts', ts])
    if (convert.code !== 0 || !existsSync(ts)) {
      throw new Error(`分段转 TS 失败：${convert.out.slice(-200)}`)
    }
    tsFiles.push(ts)
  }

  const videoOnly = join(dir, 'joined.mp4')
  const join1 = await run(ffmpeg, ['-y', '-loglevel', 'error',
    '-i', `concat:${tsFiles.join('|')}`, '-c', 'copy', videoOnly])
  for (const ts of tsFiles) rmSync(ts, { force: true })
  if (join1.code !== 0 || !existsSync(videoOnly)) throw new Error(`拼接视频失败：${join1.out.slice(-200)}`)

  // 用原片的音轨补上
  const final = await run(ffmpeg, ['-y', '-loglevel', 'error',
    '-i', videoOnly, '-i', input,
    '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', output])
  rmSync(videoOnly, { force: true })
  if (final.code !== 0) throw new Error(`合并音轨失败：${final.out.slice(-200)}`)

  // 收尾自检：拼出来的时长应接近源片；差太多说明拼接有问题，别把坏文件留给用户
  const ffprobe = ffprobeFor(ffmpeg)
  const [done, whole] = await Promise.all([
    durationOf(ffprobe, output),
    durationOf(ffprobe, input),
  ])
  if (done && whole && Math.abs(done - whole) / whole > 0.05) {
    throw new Error(`拼接结果时长异常（${done.toFixed(0)} 秒 vs 源片 ${whole.toFixed(0)} 秒）`)
  }
  // 成功后清掉缓存，避免堆积
  rmSync(dir, { recursive: true, force: true })
}

/** 「继续」：裁出剩余部分 → 交给 lada → 跑完自动拼接 */
export async function resume(input: unknown): Promise<{ success: boolean; error?: string; doneSeconds?: number }> {
  try {
    if (running) throw new Error('已经有一个续跑在进行中')
    if (typeof input !== 'string' || !input.trim()) throw new Error('缺少文件路径')
    const file = input.trim()
    if (!existsSync(file)) throw new Error('文件不存在')
    const progress = readProgress(file)
    if (!progress) throw new Error('这部片子没有可继续的进度')
    const { ffmpeg } = ladaPaths()
    if (!ffmpeg) throw new Error('没找到 ffmpeg')

    const dir = dirFor(file)
    const remainder = join(dir, `rest-${Date.now()}.mp4`)
    // -c copy 裁出剩余部分：很快，不重新编码
    const trim = await run(ffmpeg, ['-y', '-loglevel', 'error', '-ss', progress.doneSeconds.toFixed(3),
      '-i', file, '-c', 'copy', '-avoid_negative_ts', 'make_zero', remainder])
    if (trim.code !== 0 || !existsSync(remainder)) throw new Error(`裁出剩余部分失败：${trim.out.slice(-300)}`)

    const output = restoredPathFor(file)
    // lada 处理"剩余部分"，输出到缓存目录（先不覆盖最终文件）
    const partOutput = join(dir, `part${progress.parts}.mp4`)
    startJob(file, { source: remainder, output: partOutput })
    running = { input: file, output, remainder, trimStart: progress.doneSeconds }
    const expectedParts = progress.parts + 1

    onJobFinished(async finished => {
      const active = running
      if (!active || active.input !== file) return
      running = null
      rmSync(active.remainder, { force: true })
      try {
        if (finished.state !== 'done') {
          // 没跑完就保留现状，下次还能接着来
          return
        }
        const next = readProgress(file)
        writeProgress({
          input: file,
          doneSeconds: next?.doneSeconds ?? progress.doneSeconds,
          parts: expectedParts,
          preset: progress.preset,
          updatedAt: Date.now(),
        })
        await assemble(file, active.output)
        notify(`去码完成（续跑）：${basename(file)}`)
      } catch (error) {
        notify(`续跑收尾失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return { success: true, doneSeconds: progress.doneSeconds }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function notify(text: string): void {
  emit(lada, 'notice', text)
}

/** 把秒数写成 1h02m03s / 12m34s 这种给人看的形式 */
function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}h${pad(m)}m${pad(s)}s` : `${m}m${pad(s)}s`
}

/**
 * 区间去码（点哪段处理哪段）：
 *   裁出 [start, end] → 交给 lada → 用区间素材的音轨补声 → 产出一个单独的文件
 *
 * 为什么单独出一个文件、不并进整片的 .restored.mp4：整片还在处理时没法往中间插段，
 * 而且用户要的是"立刻看到这一段"。产物放在缓存目录（不写回片库，免得被当成新片子）。
 */
const rangeDirFor = (input: string): string =>
  join(cacheRoot(), 'ranges', keyFor(input))

interface RangeJob {
  input: string
  /** 裁出来的区间素材（带音轨，也是最终音轨的来源） */
  source: string
  /** lada 这一段跑出来的视频 */
  part: string
  /** 最终产物 */
  output: string
  start: number
  end: number
}

let range: RangeJob | null = null

export async function startRange(
  input: unknown,
  startSeconds: unknown,
  endSeconds: unknown
): Promise<{ success: boolean; error?: string; output?: string; start?: number; end?: number }> {
  try {
    if (range) throw new Error('已经有一个区间去码在进行中')
    if (typeof input !== 'string' || !input.trim()) throw new Error('缺少文件路径')
    const file = input.trim()
    if (!existsSync(file)) throw new Error('文件不存在')
    const { ffmpeg } = ladaPaths()
    if (!ffmpeg) throw new Error('没找到 ffmpeg')

    const start = Number(startSeconds)
    if (!Number.isFinite(start) || start < 0) throw new Error('起点不合法')
    const ffprobe = ffprobeFor(ffmpeg)
    const duration = await durationOf(ffprobe, file)
    if (duration && start >= duration - 1) throw new Error('起点已经超出片长')
    // end <= 0 视为"到片尾"
    const requested = Number(endSeconds)
    const stop = Number.isFinite(requested) && requested > 0
      ? (duration ? Math.min(requested, duration) : requested)
      : (duration ?? 0)
    if (!stop || stop <= start) throw new Error('终点要大于起点')
    const seconds = stop - start

    const dir = rangeDirFor(file)
    mkdirSync(dir, { recursive: true })
    // 清掉上一次的临时区间素材（产物 <名>.<区间>.restored.mp4 保留）
    for (const name of readdirSync(dir)) {
      if (/^src-.*\.mp4$/i.test(name)) rmSync(join(dir, name), { force: true })
    }

    const source = join(dir, `src-${Date.now()}.mp4`)
    // -ss 放在 -i 前面是快速定位（不重编码，落在最近的关键帧上，误差通常不到 1 秒）
    const trim = await run(ffmpeg, ['-y', '-loglevel', 'error',
      '-ss', start.toFixed(3), '-t', seconds.toFixed(3),
      '-i', file, '-c', 'copy', '-avoid_negative_ts', 'make_zero', source])
    if (trim.code !== 0 || !existsSync(source)) {
      throw new Error(`裁出这一段失败：${trim.out.slice(-200)}`)
    }

    const stem = basename(file).replace(/\.[^.]+$/, '')
    const output = join(dir, `${stem}.${fmtClock(start)}-${fmtClock(stop)}.restored.mp4`)
    const part = join(dir, `part-${Date.now()}.mp4`)
    try {
      startJob(file, { source, output: part })
    } catch (error) {
      // 抢不到任务（比如别的去码在跑）就把裁出来的素材收掉，别占着盘
      rmSync(source, { force: true })
      throw error
    }
    range = { input: file, source, part, output, start, end: stop }

    onJobFinished(async finished => {
      const active = range
      // 只认自己这一段的结束事件（finished.output 指向本段产物）
      if (!active || active.input !== file || finished.output !== active.part) return
      range = null
      try {
        if (finished.state !== 'done') return
        // 音轨统一从裁出来的区间素材上取，不指望 lada 的产物带声
        const mux = await run(ffmpeg, ['-y', '-loglevel', 'error',
          '-i', active.part, '-i', active.source,
          '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', active.output])
        if (mux.code !== 0) throw new Error(`合并音轨失败：${mux.out.slice(-200)}`)
        const [done, want] = await Promise.all([
          durationOf(ffprobe, active.output),
          durationOf(ffprobe, active.source),
        ])
        if (done && want && Math.abs(done - want) / want > 0.05) {
          throw new Error(`这一段时长异常（${fmtClock(done)} vs ${fmtClock(want)}）`)
        }
        broadcastRangeReady({ input: file, start: active.start, end: active.end, path: active.output })
        notify(`区间去码完成：${fmtClock(active.start)} - ${fmtClock(active.end)}`)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        broadcastRangeReady({ input: file, start: active.start, end: active.end, error: reason })
        notify(`区间去码收尾失败：${reason}`)
      } finally {
        rmSync(active.source, { force: true })
        rmSync(active.part, { force: true })
      }
    })

    return { success: true, output, start, end: stop }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 区间任务有结果了才通知界面：成功给路径，失败给原因（lada 结束时文件还没拼好） */
function broadcastRangeReady(info: {
  input: string
  start: number
  end: number
  path?: string
  error?: string
}): void {
  emit(lada, 'rangeReady', {
    ...info,
    title: `${basename(info.input)}（${fmtClock(info.start)}-${fmtClock(info.end)} 已去码）`,
  })
}

/** 查询该片已处理的进度（暂停 / 继续） */
export function resumeInfo(input: string): LadaResumeProgress | null {
  return readProgress(input)
}

/** 缓存目录总字节数 */
export function cacheSize(): number {
  try {
    let total = 0
    for (const dir of readdirSync(cacheRoot())) {
      const path = join(cacheRoot(), dir)
      for (const name of readdirSync(path)) {
        try {
          total += statSync(join(path, name)).size
        } catch {
          /* ignore */
        }
      }
    }
    return total
  } catch {
    return 0
  }
}

/** 清理可再生的缓存，保留暂停任务的进度 */
export function clearCache(): { success: boolean; freed: number } {
  // 只清"可再生"的东西：区间产物、拼接中间文件、转 TS 的碎片。
  // part*.mp4 与 progress.json 是**暂停任务的进度**，清掉就等于让人白跑，必须留着。
  let freed = 0
  const drop = (path: string, dir: boolean): void => {
    try {
      freed += dir ? 0 : statSync(path).size
      rmSync(path, { recursive: dir, force: true })
    } catch {
      /* 占用中就留给下次 */
    }
  }
  drop(join(cacheRoot(), 'ranges'), true)
  let keys: string[] = []
  try {
    keys = readdirSync(cacheRoot())
  } catch {
    return { success: true, freed }
  }
  for (const key of keys) {
    if (key === 'ranges') continue
    const dir = join(cacheRoot(), key)
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (/^part\d+\.mp4$/i.test(name) || name === 'progress.json') continue
      drop(join(dir, name), false)
    }
  }
  return { success: true, freed }
}

/** 启动时先把「上次崩溃留下的半成品」认领成可续跑的进度（而不是让清扫当垃圾删掉） */
export function initLadaResume(): void {
  void adoptLeftovers()
}

/**
 * 认领上次崩溃留下的半成品：带 `*.owner.json` 归属记录的临时视频会被收进缓存目录
 * 并登记进度，然后删掉临时文件。没有归属记录的才是真垃圾，留给清扫处理。
 */
async function adoptLeftovers(): Promise<number> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) return 0
  let adopted = 0
  let names: string[] = []
  try {
    names = readdirSync(tempDirPath())
  } catch {
    return 0
  }
  for (const name of names) {
    if (!/\.tmp\./i.test(name)) continue
    const partial = join(tempDirPath(), name)
    const sidecar = `${partial}.owner.json`
    if (!existsSync(sidecar)) continue
    try {
      const owner = JSON.parse(readFileSync(sidecar, 'utf8')) as { input?: string }
      // 进度已经登记过就别重复认领
      if (owner.input && !readProgress(owner.input)) {
        const progress = await adoptPartial(owner.input, partial)
        if (progress) adopted += 1
      }
      rmSync(partial, { force: true })
      rmSync(sidecar, { force: true })
    } catch {
      /* 单个失败不影响其它 */
    }
  }
  return adopted
}
