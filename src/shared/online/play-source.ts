/**
 * 播放源 → 可直接播放的地址：插件条目先让插件解析，仍不是直链时从页面里找 m3u8。
 * 渲染层播放器与服务端 view.resolve 共用；两步 I/O 由调用方注入。
 */
import { firstPlayUrl } from './vod-data'

/** 一集的播放源 */
export interface PlaySourceItem {
  url?: string
  /** CatSpider 插件参数（与 siteName 配合用于解析播放地址） */
  ext?: Record<string, unknown>
  /** CatSpider 站点名，缺失表示 CMS 直链 */
  siteName?: string
}

/** 解析要用的两步 I/O */
export interface PlaySourceDeps {
  /** 插件的 getPlayinfo，返回插件原样数据；失败抛错或返回 null */
  playinfo: (
    fields: Record<string, unknown> & { siteName: string; url: string }
  ) => Promise<unknown>
  /** 页面地址 → 媒体直链（引擎跟随跳转并从 HTML 里找 m3u8）；找不到原样返回 */
  resolvePage: (url: string) => Promise<string>
}

const DIRECT_MEDIA_RE = /\.(m3u8|mp4|flv)(?:\?|$)/i

/** 是否已是可直接播放的地址 */
export const isDirectMediaUrl = (url: string): boolean =>
  DIRECT_MEDIA_RE.test(url)

/** 页面地址 → 媒体直链；失败返回原地址 */
export async function resolvePageToMedia(
  url: string,
  resolvePage: PlaySourceDeps['resolvePage']
): Promise<string> {
  if (!url || isDirectMediaUrl(url)) return url
  try {
    return await resolvePage(url)
  } catch {
    return url
  }
}

/**
 * 把播放源解析为可直接播放的地址。
 *
 * 1. CatSpider 源：先由插件解析出真实地址
 * 2. 仍非直链时：跟随跳转并从页面中提取 m3u8
 * 解析失败时原样返回，交由播放器报错处理。
 */
export async function resolvePlaySource(
  item: PlaySourceItem,
  deps: PlaySourceDeps
): Promise<string> {
  const raw = typeof item.url === 'string' ? item.url.trim() : ''
  if (!raw) return ''
  let candidate = raw
  if (item.siteName && item.ext) {
    try {
      const data = await deps.playinfo({
        siteName: item.siteName,
        url: String(item.ext.url || raw),
        ...item.ext,
      })
      const url = data ? firstPlayUrl(data) : ''
      if (url) candidate = url
    } catch {
      // 插件解析失败时继续尝试通用解析
    }
  }
  return resolvePageToMedia(candidate, deps.resolvePage)
}
