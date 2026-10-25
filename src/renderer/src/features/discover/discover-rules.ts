/**
 * 库外发现的纯规则：豆瓣条目与本地媒体库去重、体积文字、状态键。不依赖 Vue / IPC，测试直接调用。
 *
 * 去重：TMDB id 相同即同一部；没有 TMDB id（主进程没令牌、没搜到）时按片名 + 年份
 * （片名归一化后与库里的片名或原名相等，年份相差不超过 1 年；任一边没年份时只比片名）。
 */

/** 一部库外的片子（豆瓣为主，TMDB 只补 id 与原名） */
export interface DiscoverTitle {
  /** 豆瓣条目 id */
  doubanId: string
  kind: 'movie' | 'tv'
  /** 中文片名（豆瓣） */
  title: string
  /** 原名（TMDB）；不知道时为空串 */
  originalTitle: string
  year: number | null
  /** 豆瓣评分文字；无评分为空串 */
  rate: string
  /** 豆瓣封面地址 */
  cover: string
  /** TMDB id；没对上时为 null */
  tmdbId: string | null
}

/** 去重要用到的媒体库条目字段 */
export interface LibraryTitleLike {
  id: number
  title: string
  originalTitle: string | null
  year: number | null
  providerIds: { tmdb?: string }
}

/** 归一化片名：NFKC、小写、去掉空白和标点 */
export function normalizeName(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 年份对得上：任一边没年份算对得上，否则相差不超过 1 年 */
function yearClose(a: number | null, b: number | null): boolean {
  return a === null || b === null || Math.abs(a - b) <= 1
}

/** 片名 + 年份是否同一部 */
export function sameTitleYear(
  title: DiscoverTitle,
  item: LibraryTitleLike
): boolean {
  const names = [title.title, title.originalTitle]
    .map(normalizeName)
    .filter(Boolean)
  const own = [item.title, item.originalTitle ?? '']
    .map(normalizeName)
    .filter(Boolean)
  return names.some(n => own.includes(n)) && yearClose(title.year, item.year)
}

/** 在一批媒体库条目里找同一部：先比 TMDB id，再比片名 + 年份 */
export function findInLibrary<T extends LibraryTitleLike>(
  title: DiscoverTitle,
  items: readonly T[]
): T | null {
  if (title.tmdbId) {
    const byId = items.find(i => i.providerIds.tmdb === title.tmdbId)
    if (byId) return byId
  }
  return items.find(i => sameTitleYear(title, i)) ?? null
}

/** 把豆瓣条目分成库里已有的和库外的（保持原顺序） */
export function splitByLibrary<T extends LibraryTitleLike>(
  titles: readonly DiscoverTitle[],
  lookup: (title: DiscoverTitle) => T | null
): {
  local: Array<{ title: DiscoverTitle; item: T }>
  missing: DiscoverTitle[]
} {
  const local: Array<{ title: DiscoverTitle; item: T }> = []
  const missing: DiscoverTitle[] = []
  const seen = new Set<number>()
  for (const title of titles) {
    const item = lookup(title)
    if (!item) missing.push(title)
    else if (!seen.has(item.id)) {
      seen.add(item.id)
      local.push({ title, item })
    }
  }
  return { local, missing }
}

/** 状态键：片名 + 年份（同一部在助手和首页共用一份状态） */
export function titleKey(title: Pick<DiscoverTitle, 'title' | 'year'>): string {
  return `${normalizeName(title.title)}|${title.year ?? ''}`
}

/** 字节数写成「4.3 GB」/「820 MB」 */
export function sizeText(bytes: number): string {
  if (bytes <= 0) return '大小未知'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** 豆瓣年份文字 → 数字；不是四位年份时为 null */
export function yearOf(text: string): number | null {
  return /^\d{4}$/.test(text.trim()) ? Number(text.trim()) : null
}
