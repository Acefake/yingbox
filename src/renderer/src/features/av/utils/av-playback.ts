/**
 * AV 播放与聚合搜索的纯规则：剧集解析、播放历史、连播、同名合并、搜索缓存键、
 * 插件搜索返回解析和收藏切换。
 */

/** 播放历史里的一条记录（按播放地址去重，最多 30 条）。 */
export interface AvPlayRecord {
  vod_name: string
  vod_pic: string
  _source: string
  epName: string
  url: string
  timestamp: number
  progress: number
  duration: number
  video: any
}
export const PLAY_HISTORY_LIMIT = 30

/** 同名合并后的一组条目（不同来源的同一部片）。 */
export type MergedGroup = {
  key: string
  vod_name: string
  vod_pic: string
  items: any[]
}

/** 已是直链（m3u8 / mp4 / flv）的地址不必再经插件解析。 */
export const PLAYABLE_URL_RE = /^https?:\/\/\S+\.(?:m3u8|mp4|flv)(?:[?#]|$)/i

/** 插件线路是否需要先经插件解析成真实地址。 */
export const needsPluginResolve = (url: string, siteName?: string): boolean =>
  !!siteName && !!url && !PLAYABLE_URL_RE.test(url)

/** 苹果 CMS 的 vod_play_url（# 分集，$ 分名称与地址，取最后一段为地址）。 */
export const parseCmsEpisodes = (video: any): { name: string; url: string }[] =>
  String(video?.vod_play_url || '')
    .split('#')
    .filter(Boolean)
    .map((ep: string) => {
      const parts = ep.split('$')
      return { name: parts[0], url: parts[parts.length - 1] }
    })

/** 写入播放历史：同一地址只留最新一条，并沿用之前记下的进度与时长。 */
export const upsertPlayHistory = (
  history: AvPlayRecord[],
  video: any,
  epName: string,
  url: string,
  now = Date.now()
): AvPlayRecord[] => {
  const previous = history.find(record => record.url === url)
  const record: AvPlayRecord = {
    vod_name: video.vod_name,
    vod_pic: video.vod_pic,
    _source: video._source,
    epName,
    url,
    timestamp: now,
    progress: previous?.progress ?? 0,
    duration: previous?.duration ?? 0,
    video,
  }
  return [record, ...history.filter(item => item.url !== url)].slice(
    0,
    PLAY_HISTORY_LIMIT
  )
}

/** 播放窗口标题：「片名 · 集名」，都没有时「正在播放」。 */
export const playTitle = (name?: string, epName?: string): string =>
  [name, epName].filter(Boolean).join(' · ') || '正在播放'

/** 片名归一化成合并键（去首尾空白、小写）。 */
export const titleKey = (name: unknown): string =>
  String(name ?? '')
    .trim()
    .toLowerCase()

/** 按片名合并不同来源的同一部片（保持首次出现的顺序）。 */
export const mergeByTitle = (videos: any[]): Map<string, MergedGroup> => {
  const map = new Map<string, MergedGroup>()
  for (const v of videos) {
    const key = titleKey(v.vod_name)
    const existing = map.get(key)
    if (existing) existing.items.push(v)
    else
      map.set(key, {
        key,
        vod_name: v.vod_name,
        vod_pic: v.vod_pic,
        items: [v],
      })
  }
  return map
}

/** 当前集的下一集；当前地址不在列表里时没有下一集。 */
export const nextEpisode = <T extends { url: string }>(
  episodes: T[],
  currentUrl: string
): T | null => {
  const index = episodes.findIndex(episode => episode.url === currentUrl)
  return index >= 0 ? (episodes[index + 1] ?? null) : null
}

/** 列表里当前片之后的那一部（按片名定位）。 */
export const nextInList = (
  groups: { items: any[] }[],
  currentName: unknown
): any | null => {
  const key = titleKey(currentName)
  const index = groups.findIndex(g => titleKey(g.items[0]?.vod_name) === key)
  return index >= 0 ? (groups[index + 1]?.items[0] ?? null) : null
}

/** 聚合搜索缓存键：关键词 + 排序后的站点集合。 */
export const searchCacheKey = (keyword: string, apis: string[]): string =>
  `${keyword}|${[...apis].sort().join(',')}`

/** 插件 search 的返回：可能是一两层 JSON 字符串；取 list 或 data.list。解析失败返回空。 */
export const parsePluginSearchList = (raw: unknown): any[] => {
  let payload: any = raw
  for (let i = 0; i < 2 && typeof payload === 'string'; i++) {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }
  const nested = payload?.data
  return Array.isArray(payload?.list)
    ? payload.list
    : Array.isArray(nested?.list)
      ? nested.list
      : []
}

/** 收藏切换（按 _uid）：已收藏则移除，否则追加到末尾。 */
export const toggleFavorite = (list: any[], video: any): any[] =>
  list.some(f => f._uid === video._uid)
    ? list.filter(f => f._uid !== video._uid)
    : [...list, video]
