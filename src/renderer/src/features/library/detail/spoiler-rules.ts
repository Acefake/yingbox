/**
 * 防剧透（设置 ui.spoilerGuard）的纯规则：剧集详情里哪一集算「看过」，没看过的剧照模糊、简介折叠。
 *
 * 一集的「键」是它视频文件的播放进度键（桌面端文件路径，网页端片库服务的流地址），与播放器记进度用的一致。
 * 看过的依据（任一成立即可）：
 * - 播放进度表里这个键播过至少 SEEN_MIN_PROGRESS 秒，或带着「看完」标记（位置 0、时长已知）；
 * - 这部剧的「继续播放」记录：连播列表里当前集之前的都算看过；当前集已开始看（不是「下一集」）也算。
 * 不依赖 Vue 和存储，取数在 use-spoiler-guard.ts。
 */
import type { ContinueRecord } from '@/features/player'

/** 播过这么多秒就算看过这一集（误点进来马上关掉不算）。 */
export const SEEN_MIN_PROGRESS = 10

/** 播放进度表里的一条。 */
export interface ProgressEntry {
  progress: number
  duration: number
}

/** 进度表的一条是否说明看过：播过一段，或看完标记（看完时位置记成 0、时长保留）。 */
export function progressSeen(entry: ProgressEntry | null | undefined): boolean {
  if (!entry) return false
  return (
    entry.progress >= SEEN_MIN_PROGRESS ||
    (entry.progress === 0 && entry.duration > 0)
  )
}

/** 连播列表一项的进度键（与 mediaProgressKey 相同：地址优先，其次文件路径）。 */
const entryKey = (entry: { url?: string; filePath?: string }): string =>
  (entry.url || entry.filePath || '').trim()

/** 从这部剧的「继续播放」记录推出看过的进度键。 */
export function seenKeysFromContinue(
  record: Pick<ContinueRecord, 'replay' | 'nextUp' | 'progress'> | undefined
): Set<string> {
  const seen = new Set<string>()
  const playlist = record?.replay.playlist ?? []
  if (!record || !playlist.length) return seen
  const index = Math.min(record.replay.index ?? 0, playlist.length - 1)
  const upTo =
    !record.nextUp && record.progress >= SEEN_MIN_PROGRESS ? index : index - 1
  for (let i = 0; i <= upTo; i++) {
    const key = entryKey(playlist[i])
    if (key) seen.add(key)
  }
  return seen
}

/** 这一集是否看过：任一文件键在继续播放推出的集合里，或在进度表里有看过的记录。 */
export function isEpisodeSeen(
  keys: readonly string[],
  seen: ReadonlySet<string>,
  progressOf: (key: string) => ProgressEntry | null
): boolean {
  return keys.some(key => seen.has(key) || progressSeen(progressOf(key)))
}

/** 是否要遮住这一集（剧照模糊、简介折叠）：开关打开且没看过。没有本地文件的集也算没看过。 */
export function spoilerHidden(
  enabled: boolean,
  keys: readonly string[],
  seen: ReadonlySet<string>,
  progressOf: (key: string) => ProgressEntry | null
): boolean {
  return enabled && !isEpisodeSeen(keys, seen, progressOf)
}
