/**
 * CMS / CatSpider 返回数据的纯解析：外部数据只在这里整理成 CmsItem / EpisodeGroup。
 */
import type { ApiSite, CatSpiderSite, CmsItem, EpisodeGroup } from '../types'

/** CatSpider 插件同时存在对象返回和 JSON 字符串返回两种实现（最多解两层字符串）。 */
export const normalizeVodPayload = (payload: unknown): any => {
  let value: any = payload
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' ? value : null
}

/** 取出 payload.list 或 payload.data.list；都没有时返回空数组。 */
export const getVodList = (payload: unknown): any[] => {
  const data = normalizeVodPayload(payload)
  if (!data) return []
  const nested = normalizeVodPayload(data.data)
  return Array.isArray(data.list)
    ? data.list
    : Array.isArray(nested?.list)
      ? nested.list
      : []
}

/** CMS 搜索结果补上来源字段。 */
export const toCmsSearchItems = (list: CmsItem[], site: ApiSite): CmsItem[] =>
  list.map(item => ({
    ...item,
    source_name: site.name,
    api_url: site.api,
    _source: 'cms' as const,
  }))

/** CatSpider 搜索结果整理成 CmsItem（vod_id 缺失时用 ext.url）。 */
export const toCatSpiderSearchItems = (
  list: any[],
  site: CatSpiderSite
): CmsItem[] =>
  list.map(item => ({
    vod_id: item.vod_id || item.ext?.url || '',
    vod_name: item.vod_name || '',
    type_name: item.type_name || '',
    vod_year: item.vod_year || '',
    vod_remarks: item.vod_remarks || '',
    vod_pic: item.vod_pic || '',
    vod_content: item.vod_desc || item.vod_content || '',
    source_name: site.name,
    api_url: site.api,
    _source: 'catspider' as const,
    _siteName: site.name,
    _ext: item.ext || {},
  }))

/**
 * 苹果 CMS 详情的 vod_play_url（线路用 $$$ 分隔、集用 # 分隔、名称与地址用 $ 分隔）
 * 解析成线路分组；只保留 http(s) 地址，没有可播集数的线路丢弃。
 */
export const parseCmsGroups = (
  detail: CmsItem | undefined,
  siteName: string
): EpisodeGroup[] => {
  if (!detail?.vod_play_url) return []
  const fromNames = (detail.vod_play_from || '').split('$$$')
  const playSources = detail.vod_play_url.split('$$$')

  return playSources
    .map((source, i) => {
      const episodes = source
        .split('#')
        .filter(Boolean)
        .map((ep, j) => {
          const parts = ep.split('$')
          const url = parts.length > 1 ? parts[1] : ''
          const name = parts[0] || `第${j + 1}集`
          return { name, url }
        })
        .filter(
          e => e.url.startsWith('http://') || e.url.startsWith('https://')
        )

      const fromLabel = fromNames[i]?.trim()
      const label =
        playSources.length > 1 ? `${siteName}-${fromLabel || i + 1}` : siteName
      // 很多站点返回的是无扩展名的播放接口或带签名参数的地址，
      // 不能只靠 .m3u8/.mp4 后缀判断是否可播放。
      const hasDirect = episodes.some(e => /^https?:\/\//i.test(e.url))
      return {
        label,
        episodes,
        hasDirect,
        _source: 'cms' as const,
        _siteName: siteName,
      }
    })
    .filter(g => g.episodes.length && g.hasDirect)
}

/**
 * CatSpider getTracks 返回的分组列表 → 线路分组。兼容三种插件写法：
 * A. group.tracks[]（茶杯狐等）；B. group 本身是苹果 CMS 格式（荐片）；C. group.list[]。
 */
export const parseCatSpiderGroups = (
  list: any[],
  siteName: string
): EpisodeGroup[] => {
  const groups: EpisodeGroup[] = []
  const base = {
    hasDirect: true,
    _source: 'catspider' as const,
    _siteName: siteName,
  }
  for (const group of list) {
    if (Array.isArray(group.tracks) && group.tracks.length) {
      groups.push({
        ...base,
        label: group.name || group.title || siteName,
        episodes: group.tracks.map((ep: any) => {
          const ext = ep.ext || {}
          const url = ep.url || ext.url || ''
          // 保留插件需要的 id、referer 等字段，同时确保直链可回退播放。
          return {
            name: ep.name || ep.title || '',
            url,
            ext: { ...ext, url: ext.url || url },
          }
        }),
      })
    } else if (group.vod_play_url) {
      const fromNames = (group.vod_play_from || '').split('$$$')
      const playSources = (group.vod_play_url as string).split('$$$')
      playSources.forEach((src, i) => {
        const episodes = src
          .split('#')
          .filter(Boolean)
          .map((ep, j) => {
            const parts = ep.split('$')
            const epUrl = parts.length > 1 ? parts[1] : ''
            return { name: parts[0] || `第${j + 1}集`, url: epUrl, ext: {} }
          })
          .filter(e => e.url.startsWith('http'))
        if (!episodes.length) return
        const fromLabel = fromNames[i]?.trim()
        const label =
          playSources.length > 1
            ? `${siteName}-${fromLabel || i + 1}`
            : fromLabel || siteName
        groups.push({ ...base, label, episodes })
      })
    } else if (Array.isArray(group.list) && group.list.length) {
      groups.push({
        ...base,
        label: group.name || group.title || siteName,
        episodes: group.list.map((ep: any) => ({
          name: ep.name || ep.title || '',
          url: ep.url || '',
          ext: ep.ext || {},
        })),
      })
    }
  }
  return groups
}

/** 条目要查详情的 CMS 来源：聚合条目用 sources，否则用自身的 api_url。 */
export const cmsDetailSources = (item: CmsItem) =>
  item.sources?.length
    ? item.sources
    : item.api_url
      ? [
          {
            source_name: item.source_name || '未知',
            api_url: item.api_url,
            vod_id: item.vod_id,
          },
        ]
      : []

/** 插件 getPlayinfo 返回里的第一个播放地址。 */
export const firstPlayUrl = (data: any): string => {
  const urls = data?.urls || data?.data?.urls || []
  return urls[0] || ''
}
