/**
 * 悬停预览的公共类型：卡片只认「预览来源」，不关心视频从哪来。
 *
 * 豆瓣卡给预告片 mp4，媒体库卡给本地片段或已缓存的剧照，在线搜索结果卡暂不给（每次要解析源，太重），
 * 以后接入只需实现一个 PreviewSource。
 */

/** 预览要播的东西：一段视频，或一组轮播的图片。 */
export type PreviewMedia =
  | {
      kind: 'video'
      url: string
      /** 起播位置占片长的比例（0–1），如本地影片从 10% 处开始 */
      startRatio?: number
      /** 只循环播这么多秒；不给则整段循环 */
      clipSeconds?: number
      /** 视频播不了（编码不支持、地址失效）时改为轮播的图片 */
      fallback?: string[]
    }
  | {
      kind: 'images'
      urls: string[]
      /** 每张停留的毫秒数，默认 1200 */
      intervalMs?: number
    }

/** 一张卡的预览来源：悬停满延时才调用 resolve，离开时 signal 中止。 */
export interface PreviewSource {
  /** 全局唯一的键（同一张卡多次进入不重复取） */
  readonly key: string
  /** 取要播的东西；没有预览返回 null（卡片保持静态封面） */
  resolve(signal: AbortSignal): Promise<PreviewMedia | null>
}

/** 用户设置：开关与悬停延时。 */
export interface PreviewSettings {
  enabled: boolean
  delayMs: number
}

/** 默认：开启，悬停 600 ms 后播放。 */
export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  enabled: true,
  delayMs: 600,
}
