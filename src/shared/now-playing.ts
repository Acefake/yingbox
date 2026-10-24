/**
 * 「正在播放」的跨进程数据：内置播放器把当前状态报给主进程（托盘菜单、媒体键），
 * 主进程把托盘菜单与媒体键的操作作为命令推回渲染层。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

/** 托盘与媒体键能发出的播放命令 */
export const MEDIA_COMMANDS = ['playpause', 'next', 'previous'] as const
export type MediaCommand = (typeof MEDIA_COMMANDS)[number]

/** 内置播放器当前的状态（没在播时报 null） */
export interface NowPlaying {
  /** 当前条目名（集名 / 文件名） */
  title: string
  /** 正在播放（false = 暂停中） */
  playing: boolean
  /** 有下一集 */
  hasNext: boolean
  /** 有上一集 */
  hasPrevious: boolean
}

/** 标题最长保留的字符数（托盘菜单与提示文字放不下更长的） */
export const NOW_PLAYING_TITLE_MAX = 200

/** 解析渲染层报来的状态；外形不对返回 undefined，null 表示没在播 */
export function parseNowPlaying(raw: unknown): NowPlaying | null | undefined {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.title !== 'string') return undefined
  for (const key of ['playing', 'hasNext', 'hasPrevious'] as const)
    if (typeof value[key] !== 'boolean') return undefined
  return {
    title: value.title.trim().slice(0, NOW_PLAYING_TITLE_MAX),
    playing: value.playing as boolean,
    hasNext: value.hasNext as boolean,
    hasPrevious: value.hasPrevious as boolean,
  }
}
