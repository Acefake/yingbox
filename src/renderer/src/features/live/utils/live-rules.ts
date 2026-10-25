/**
 * 直播页的纯规则：直播源记录的校验、多源频道合并、分组、搜索、换线与 HLS 判定。
 */
import { type LiveChannel, splitEpgUrls } from './playlist-parse'

/** 一个直播源（用户添加的播放列表） */
export interface LiveSource {
  id: string
  name: string
  /** url：远程地址；file：本地文件路径 */
  kind: 'url' | 'file'
  location: string
  /** 用户填写的节目单地址（逗号分隔可多个）；空则用播放列表头里的 x-tvg-url */
  epgUrl: string
  enabled: boolean
}

/** 分组列表里的一项 */
export interface LiveGroup {
  key: string
  label: string
  count: number
}

/** 「收藏」「全部」两个固定分组的键 */
export const FAVORITES_GROUP = '__favorites'
export const ALL_GROUP = '__all'
/** 一个源最多使用的节目单数 */
export const MAX_EPG_PER_SOURCE = 3

/** 从存储读出的值规范化为直播源；非法返回 null */
export function sanitizeSource(value: unknown): LiveSource | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<LiveSource>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (raw.kind !== 'url' && raw.kind !== 'file') return null
  const location = typeof raw.location === 'string' ? raw.location.trim() : ''
  if (!location) return null
  return {
    id: raw.id,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : location,
    kind: raw.kind,
    location,
    epgUrl: typeof raw.epgUrl === 'string' ? raw.epgUrl.trim() : '',
    enabled: raw.enabled !== false,
  }
}

/** 远程直播源地址是否可用（http / https） */
export function isValidSourceUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 远程源的默认名称：主机名 + 文件名 */
export function defaultSourceName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    const file = pathname.split('/').filter(Boolean).pop()
    return file ? `${hostname} · ${decodeURIComponent(file)}` : hostname
  } catch {
    return url
  }
}

/** 这个源实际使用的节目单地址：用户填的优先，否则用播放列表头里的 */
export function epgUrlsFor(source: LiveSource, headerUrls: string[]): string[] {
  const own = splitEpgUrls(source.epgUrl)
  return (own.length ? own : headerUrls).slice(0, MAX_EPG_PER_SOURCE)
}

/**
 * 合并多个源的频道：同名频道（同一个 id）合成一个，线路按源的顺序依次追加。
 * 分组、台标等取第一次出现的值。
 */
export function combineChannels(
  lists: readonly LiveChannel[][]
): LiveChannel[] {
  const byId = new Map<string, LiveChannel>()
  for (const list of lists)
    for (const channel of list) {
      const existing = byId.get(channel.id)
      if (!existing) {
        byId.set(channel.id, { ...channel, urls: [...channel.urls] })
        continue
      }
      for (const url of channel.urls)
        if (!existing.urls.includes(url)) existing.urls.push(url)
      existing.tvgId ||= channel.tvgId
      existing.logo ||= channel.logo
    }
  return [...byId.values()]
}

/** 分组列表：收藏、全部，再按首次出现顺序列出各分组 */
export function buildGroups(
  channels: readonly LiveChannel[],
  favorites: ReadonlySet<string>
): LiveGroup[] {
  const counts = new Map<string, number>()
  for (const c of channels) counts.set(c.group, (counts.get(c.group) ?? 0) + 1)
  const favoriteCount = channels.filter(c => favorites.has(c.id)).length
  return [
    { key: FAVORITES_GROUP, label: '收藏', count: favoriteCount },
    { key: ALL_GROUP, label: '全部', count: channels.length },
    ...[...counts].map(([label, count]) => ({ key: label, label, count })),
  ]
}

/** 当前分组 + 搜索词下的频道（搜索词匹配名称，忽略大小写与空白） */
export function filterChannels(
  channels: readonly LiveChannel[],
  group: string,
  query: string,
  favorites: ReadonlySet<string>
): LiveChannel[] {
  const q = query.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  return channels.filter(c => {
    if (group === FAVORITES_GROUP) {
      if (!favorites.has(c.id)) return false
    } else if (group !== ALL_GROUP && c.group !== group) return false
    return !q || c.id.includes(q)
  })
}

/** 线路失败后的下一条；已是最后一条返回 null */
export function nextLine(current: number, total: number): number | null {
  return current + 1 < total ? current + 1 : null
}

/**
 * 直播地址是否按 HLS 播放：明确是 mp4 / webm / flv / ts 等直链时不走 hls.js，
 * 其余（.m3u8 以及各种不带扩展名的接口地址）都按 HLS。
 */
export function isLikelyHls(url: string): boolean {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // 非标准地址：按原串判断
  }
  return !/\.(mp4|m4v|webm|mkv|mov|flv|mp3|aac)$/i.test(path)
}

/** 切换收藏：返回新的收藏列表（保持顺序，新加的在末尾） */
export function toggleFavorite(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

/** 生成直播源 id */
export function newSourceId(now = Date.now()): string {
  return `src-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 没有台标时台标位显示的短名：取第一个空格前的部分（「CCTV-1 综合」→「CCTV-1」），
 * 否则去掉「卫视 / 频道 / 台」后缀（「北京卫视」→「北京」），最多 7 个字符。
 * @param name 频道名
 */
export function logoText(name: string): string {
  const trimmed = name.trim()
  const head = trimmed.split(/\s+/)[0] || trimmed
  const short = head === trimmed ? head.replace(/(卫视|频道|台)$/, '') : head
  return [...(short || head)].slice(0, 7).join('')
}
