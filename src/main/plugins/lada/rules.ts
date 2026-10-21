/**
 * 去码（lada）的纯规则：格式校验、命令行参数、进度行切分、时长解析、
 * 区间计算、HLS 播放列表、缓存文件归类。
 *
 * 只依赖 node:path，不碰 electron / 文件系统，方便单测。
 */
import { basename, isAbsolute, join } from 'node:path'
import type { LadaJob } from '../../../shared/lada'

/** 允许处理的视频扩展名 */
export const VIDEO_EXTS = [
  '.mp4',
  '.mkv',
  '.avi',
  '.wmv',
  '.mov',
  '.m4v',
  '.ts',
  '.m2ts',
  '.flv',
  '.webm',
]
/** 与用户确认过的默认编码预设（NVIDIA 硬件编码） */
export const ENCODING_PRESET = 'hevc-nvidia-gpu-hq'
/** 「边跑边看」每个分片的秒数。够小才能尽快出画，够大才不至于切得太碎 */
export const SEGMENT_SECONDS = 10

/** lada-cli / ffmpeg 的路径覆盖 */
export type Overrides = { cli?: string; ffmpeg?: string }

/** 从磁盘读到的覆盖设置只保留绝对路径字符串 */
export function sanitizeOverrides(raw: unknown): Overrides | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Overrides
  return {
    ...(typeof value.cli === 'string' && isAbsolute(value.cli)
      ? { cli: value.cli }
      : {}),
    ...(typeof value.ffmpeg === 'string' && isAbsolute(value.ffmpeg)
      ? { ffmpeg: value.ffmpeg }
      : {}),
  }
}

/** 扩展名不在白名单时返回错误提示，否则 null */
export function videoExtProblem(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return VIDEO_EXTS.includes(ext) ? null : `不支持的格式：${ext || '未知'}`
}

/** lada 在临时目录里写的"纯视频半成品"路径（与它内部的命名规则一致） */
export function tempVideoFor(tempDir: string, output: string): string {
  const name = output.split(/[/\\]/).pop() || ''
  const base = name.replace(/\.[^.]+$/, '')
  const ext = name.slice(name.lastIndexOf('.'))
  return join(tempDir, `${base}.tmp${ext}`)
}

/** 别的实例占着锁时给用户的提示 */
export function foreignJobMessage(input?: string): string {
  const name = input ? input.split(/[\\/]/).pop() : ''
  return `已有一个去码任务在跑${name ? `：${name}` : ''}（可能来自另一个影盒窗口），请等它结束`
}

/** lada-cli 命令行参数 */
export function ladaArgs(
  source: string,
  output: string,
  tempDir: string
): string[] {
  return [
    '--input',
    source,
    '--output',
    output,
    '--temporary-directory',
    tempDir,
    '--encoding-preset',
    ENCODING_PRESET,
    '--mp4-fast-start',
  ]
}

/** lada 非零退出时的错误信息（带上最后一条进度文字） */
export function exitError(code: number | null, message: string): string {
  return message
    ? `lada 退出（代码 ${code}）：${message}`
    : `lada 退出（代码 ${code}）`
}

/** tqdm 用 \r 刷新同一行，所以 \r 和 \n 都要当分隔符；返回完整行与剩下的半行 */
export function splitProgress(buffer: string): {
  lines: string[]
  rest: string
} {
  const parts = buffer.split(/[\r\n]/)
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

/** 把解析出的进度字段合进任务（只覆盖解析到的字段） */
export function applyProgress(
  job: LadaJob,
  parsed: { percent?: number; fps?: number; frames?: number; message?: string }
): void {
  if (parsed.percent !== undefined) job.percent = parsed.percent
  if (parsed.fps !== undefined) job.fps = parsed.fps
  if (parsed.frames !== undefined) job.frames = parsed.frames
  if (parsed.message) job.message = parsed.message
}

/** 启动清扫时临时目录里一个条目的处置 */
export type TempEntryKind = 'sidecar' | 'partial' | 'other'

/** 归类临时目录条目：归属记录 / 半成品视频 / 与清扫无关 */
export function classifyTempEntry(name: string): TempEntryKind {
  if (/\.owner\.json$/i.test(name)) return 'sidecar'
  if (/\.tmp\./i.test(name)) return 'partial'
  return 'other'
}

/** 归属记录对应的半成品文件名 */
export const sidecarVideo = (name: string): string =>
  name.slice(0, -'.owner.json'.length)

/** 从 ffprobe 输出里读一个正数字段（如 duration=12.3） */
export function probeNumber(out: string, field: string): number {
  return Number((out.match(new RegExp(`${field}=([\\d.]+)`)) || [])[1] ?? NaN)
}

/** ffprobe 的 format=duration 输出 → 正时长；读不到返回 null */
export function parseDuration(out: string): number | null {
  const value = probeNumber(out, 'duration')
  return Number.isFinite(value) && value > 0 ? value : null
}

/** ffprobe 的 format=start_time,duration 输出 → 起点与时长；读不到返回 null */
export function parseSegmentProbe(
  out: string
): { start: number; duration: number } | null {
  const start = probeNumber(out, 'start_time')
  const duration = probeNumber(out, 'duration')
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0)
    return null
  return { start, duration }
}

/** 拼接 / 区间产物的时长自检：偏差超过 5% 视为异常 */
export const durationMismatch = (
  done: number | null,
  want: number | null
): boolean => Boolean(done && want && Math.abs(done - want) / want > 0.05)

/** 把秒数写成 1h02m03s / 12m34s 这种给人看的形式 */
export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}h${pad(m)}m${pad(s)}s` : `${m}m${pad(s)}s`
}

/** 校验区间起点（读片长之前就能判断的部分） */
export function rangeStart(startSeconds: unknown): number {
  const start = Number(startSeconds)
  if (!Number.isFinite(start) || start < 0) throw new Error('起点不合法')
  return start
}

/**
 * 区间终点（片长未知时 duration 为 null）：起点不能落在片尾 1 秒内；
 * end <= 0 视为"到片尾"，超出片长截到片尾。
 */
export function rangeStop(
  start: number,
  endSeconds: unknown,
  duration: number | null
): number {
  if (duration && start >= duration - 1) throw new Error('起点已经超出片长')
  const requested = Number(endSeconds)
  const stop =
    Number.isFinite(requested) && requested > 0
      ? duration
        ? Math.min(requested, duration)
        : requested
      : (duration ?? 0)
  if (!stop || stop <= start) throw new Error('终点要大于起点')
  return stop
}

/** 区间产物文件名：<原名>.<起>-<止>.restored.mp4 */
export function rangeOutputName(
  file: string,
  start: number,
  stop: number
): string {
  const stem = basename(file).replace(/\.[^.]+$/, '')
  return `${stem}.${fmtClock(start)}-${fmtClock(stop)}.restored.mp4`
}

/** 缓存目录里的分段文件名（part0.mp4…）按序号排序 */
export function sortParts(names: string[]): string[] {
  return names
    .filter(n => /^part\d+\.mp4$/.test(n))
    .sort((a, b) => Number(a.slice(4, -4)) - Number(b.slice(4, -4)))
}

/** 分片文件名 seg00000.ts */
export const segmentName = (index: number): string =>
  `seg${String(index).padStart(5, '0')}.ts`

/** 追播 HTTP 服务只放行这种文件名（防路径穿越） */
export const isServableName = (name: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(name)

/** EVENT 型 HLS 播放列表：只增不减，正是边处理边看的语义；EXTINF 写实测时长 */
export function buildPlaylist(
  segments: { name: string; duration: number }[],
  ended: boolean
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 2}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
  ]
  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`)
    lines.push(seg.name)
  }
  if (ended) lines.push('#EXT-X-ENDLIST')
  return `${lines.join('\n')}\n`
}

/** 追播一轮切出的分片如何处理 */
export type SegmentVerdict = 'publish' | 'retry' | 'finish'

/**
 * 判断切出来的一段：数据不足时 -c copy 只会切出很短的一截。
 * lada 还在跑 → 丢掉等下一轮；已结束 → 这段就是片尾，短点也收下（太短则收尾）。
 */
export function segmentVerdict(
  duration: number,
  ladaRunning: boolean
): SegmentVerdict {
  if (duration >= SEGMENT_SECONDS * 0.95) return 'publish'
  if (ladaRunning) return 'retry'
  return duration < 0.5 ? 'finish' : 'publish'
}
