/**
 * 播放会话里「当前条目 → 弹幕匹配目标」的纯规则：剧名 + 集名（列表多于一项时带集名与序号），
 * 本地文件带路径（优先按文件 hash 识别）。
 */
import type { PlaylistEntry } from '../utils/play-queue'
import type { DanmakuTarget } from './danmaku-rules'

/** 由播放队列与当前位置算出弹幕匹配目标；当前没有条目时为 null */
export function danmakuTargetFor(input: {
  playlist: readonly PlaylistEntry[]
  position: number
  /** 会话默认标题（「正在播放」表示调用方没给剧名） */
  title: string
  /** 实际在播的条目（可能是备用线路），取它的本地路径 */
  current: PlaylistEntry | null
  /** 条目显示名 */
  label: (entry: PlaylistEntry) => string
}): DanmakuTarget | null {
  const entry = input.playlist[input.position]
  if (!entry) return null
  const multi = input.playlist.length > 1
  return {
    title: input.title === '正在播放' ? input.label(entry) : input.title,
    episode: multi ? entry.name?.trim() || undefined : undefined,
    index: multi ? input.position + 1 : undefined,
    filePath: input.current?.filePath || undefined,
  }
}
