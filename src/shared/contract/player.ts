import { call, defineDomain, event, record } from './define'

/** 播放列表条目：用于自动连播与失败换源 */
export interface PlayerSourceItem {
  url?: string
  filePath?: string
  /** 展示名（集名 / 文件名） */
  name?: string
  /** CatSpider 插件参数 */
  ext?: Record<string, unknown>
  /** CatSpider 站点名 */
  siteName?: string
}

/** 播放窗口载荷 */
export interface PlayerOpenPayload {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
  /** 播放队列；配合 index 决定起始项 */
  playlist?: PlayerSourceItem[]
  /** 起始项下标 */
  index?: number
  /** 同集备用线路：播放失败时优先尝试 */
  fallbacks?: PlayerSourceItem[]
}

/** 独立播放窗口（内置播放器）。 */
export const player = defineDomain(
  'player',
  {
    /** 打开或复用播放窗口；载荷由主进程规范化 */
    open: call<
      [payload: PlayerOpenPayload],
      { success: boolean; error?: string }
    >(a => [record<PlayerOpenPayload>(a[0], 'payload')]),
    /** 关闭播放窗口 */
    close: call<{ success: boolean }>(),
    /** 播放窗口启动后取待播载荷 */
    getPending: call<PlayerOpenPayload | null>(),
  },
  {
    /** 已打开的播放窗口收到新的载荷 */
    load: event<PlayerOpenPayload>(),
  }
)
