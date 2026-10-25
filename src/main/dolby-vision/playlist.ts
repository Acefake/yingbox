/**
 * 杜比视界 HLS 的播放列表与分片调度规则（纯函数）。
 *
 * 播放列表一开始就按片长写成完整的 VOD（每段 SEGMENT_SECONDS 秒，末段取余数），播放器拿到整条时间轴，
 * 进度条与拖动和普通文件一样。分片按需编码：请求的分片已编好就直接给；
 * 在编码器前方不远就等；往回拖或拖到远处就从那一段重启编码。每轮编码只编 RUN_SEGMENTS 段就退出
 * （filters.ts 的 -t），播放位置追近前沿时再续编，所以编码器最多领先播放位置一轮。
 */
import { SEGMENT_SECONDS, segmentFile } from './filters'

/** 请求落在编码前沿之后多少段以内就等，不重启 */
export const LOOKAHEAD_SEGMENTS = 3
/** 一轮编完后播放位置追到离前沿这么近时，从前沿续编 */
export const RESUME_AHEAD_SEGMENTS = 15
/** 播放位置之前保留多少段（往回拖一点不必重编），更早的删掉 */
export const KEEP_BEHIND_SEGMENTS = 15

/** 片长切成多少段。 */
export const segmentCount = (duration: number): number =>
  Math.max(1, Math.ceil(duration / SEGMENT_SECONDS - 1e-6))

/** 某个时间点落在第几段。 */
export const segmentAt = (seconds: number, count: number): number =>
  Math.min(count - 1, Math.max(0, Math.floor(seconds / SEGMENT_SECONDS)))

/** 完整的 VOD 播放列表（fMP4，init.mp4 作为 EXT-X-MAP）。 */
export function buildVodPlaylist(duration: number): string {
  const count = segmentCount(duration)
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MAP:URI="init.mp4"',
  ]
  for (let i = 0; i < count; i++) {
    const length =
      i === count - 1 ? duration - i * SEGMENT_SECONDS : SEGMENT_SECONDS
    lines.push(`#EXTINF:${Math.max(0.001, length).toFixed(3)},`, segmentFile(i))
  }
  lines.push('#EXT-X-ENDLIST', '')
  return lines.join('\n')
}

/** 本机 HTTP 服务能回答的请求。 */
export type HlsRequest =
  | { kind: 'playlist' }
  | { kind: 'init' }
  | { kind: 'segment'; index: number }

/** 解析请求路径里的文件名（已去掉会话令牌前缀）；其他一律拒绝。 */
export function parseRequestName(name: string): HlsRequest | null {
  if (name === 'index.m3u8') return { kind: 'playlist' }
  if (name === 'init.mp4') return { kind: 'init' }
  const match = /^seg(\d{5})\.m4s$/.exec(name)
  return match ? { kind: 'segment', index: Number(match[1]) } : null
}

/** 编码器此刻的状态（调度只看这些）。 */
export interface EncoderState {
  /** 正在编码时：这一轮从第几段开始；没在编码为 null */
  runningFrom: number | null
  /** 已编好的分片序号 */
  ready: ReadonlySet<number>
}

/** 从 from 开始连续编好的最后一段；from 本身没好返回 from - 1。 */
export function readyFrontier(
  ready: ReadonlySet<number>,
  from: number
): number {
  let i = from
  while (ready.has(i)) i++
  return i - 1
}

/** 一个分片请求怎么处理：serve 直接给，wait 等编码器，restart 从这一段重启编码。 */
export function planSegment(
  state: EncoderState,
  index: number
): 'serve' | 'wait' | 'restart' {
  if (state.ready.has(index)) return 'serve'
  const from = state.runningFrom
  if (from === null || index < from) return 'restart'
  const frontier = readyFrontier(state.ready, from)
  return index > frontier + 1 + LOOKAHEAD_SEGMENTS ? 'restart' : 'wait'
}

/**
 * 编码器停着（一轮编完）、播放位置追近已编好的前沿：返回续编的起始段；不用续返回 null。
 * @param count 总段数（编到最后一段就不再续）
 */
export function resumeFrom(
  state: EncoderState,
  playing: number,
  count: number
): number | null {
  if (state.runningFrom !== null) return null
  const frontier = readyFrontier(state.ready, playing)
  if (frontier + 1 >= count) return null
  return frontier - playing <= RESUME_AHEAD_SEGMENTS ? frontier + 1 : null
}

/** 可以删掉的旧分片（播放位置之前 KEEP_BEHIND_SEGMENTS 段以外的）。 */
export function prunable(
  ready: ReadonlySet<number>,
  playing: number
): number[] {
  return [...ready].filter(i => i < playing - KEEP_BEHIND_SEGMENTS)
}
