import axios from 'axios'
import { useVODParser } from '@/composables/use-vod-parser'

/**
 * 播放源条目。
 *
 * 同时服务于在线源与本地文件：
 *  - 在线：`url`（可能是页面地址，需解析成 m3u8/mp4）
 *  - 本地：`filePath`（播放器内部转成 local:// 地址）
 */
export interface PlaySourceItem {
  url?: string
  filePath?: string
  /** 展示名（集名 / 文件名） */
  name?: string
  /** CatSpider 插件参数（与 siteName 配合用于解析播放地址） */
  ext?: Record<string, unknown>
  /** CatSpider 站点名，缺失表示 CMS 直链 */
  siteName?: string
}

const DIRECT_MEDIA_RE = /\.(m3u8|mp4|flv)(?:\?|$)/i

/** 判断是否已是可直接播放的地址 */
export const isDirectMediaUrl = (url: string): boolean => DIRECT_MEDIA_RE.test(url)

/**
 * 把播放源解析为可直接播放的地址。
 *
 * 1. CatSpider 源：先由插件（后端）解析出真实地址
 * 2. 仍非直链时：跟随跳转并从页面中提取 m3u8
 * 解析失败时原样返回，交由播放器报错处理。
 */
export async function resolvePlaySource(item: PlaySourceItem): Promise<string> {
  const raw = typeof item.url === 'string' ? item.url.trim() : ''
  if (!raw) return ''
  let candidate = raw

  if (item.siteName && item.ext) {
    try {
      const { getPlayinfo } = useVODParser()
      const r = await getPlayinfo({
        siteName: item.siteName,
        url: String((item.ext as Record<string, unknown>).url || raw),
        ...item.ext,
      })
      const urls = r?.data?.urls || r?.data?.data?.urls || []
      if (r?.success && urls[0]) candidate = String(urls[0])
    } catch {
      // 插件解析失败时继续尝试通用解析
    }
  }

  if (isDirectMediaUrl(candidate)) return candidate
  return await resolvePageToMedia(candidate)
}

/**
 * 页面地址 → 媒体直链。
 * 先看 axios 跟随跳转后的最终地址，再从 HTML 中提取 m3u8。
 */
export async function resolvePageToMedia(url: string): Promise<string> {
  if (!url || isDirectMediaUrl(url)) return url
  try {
    const r = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      responseType: 'text',
    })
    const final: string = (r.request as { responseURL?: string })?.responseURL || url
    if (isDirectMediaUrl(final)) return final
    const m = String(r.data).match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i)
    if (m) return m[0]
  } catch {
    // 保留原始地址
  }
  return url
}
