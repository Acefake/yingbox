/**
 * 影片展示的纯规则：海报卡封面 / 副标题、详情页的信息行 / 来源链接 / 剧照、
 * 用户标签增删后的列表、悬停预览的轮播图与定位。
 *
 * 图片地址转换（amaneImage）依赖运行环境，由调用方以 `toImage` 传入。
 */
import type { AmaneFilm, AmaneUserTag } from '../api/amane'

/** 把 Amane 资源地址转成可加载的图片地址；不可加载时返回空串 */
export type ToImage = (source?: string | null) => string

/** 海报卡封面的原始地址：优先竖版海报，没有时退到横版缩略图 */
export const filmCoverSource = (film: AmaneFilm): string | null =>
  film.poster_url || film.poster_urls?.[0] || film.thumb_url

/** 海报卡的一行副标题：番号（标题缺失时已作标题，不重复）· 前两位演员，没有演员时用发行年份 */
export function filmSubtitle(film: AmaneFilm): string {
  const extra = film.actors.length
    ? film.actors.slice(0, 2).join(' / ')
    : film.release?.slice(0, 4)
  return [film.title ? film.number : '', extra].filter(Boolean).join(' · ')
}

/** 片长分钟数 → 「1h 5m」 */
export const runtimeText = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h ${minutes % 60}m`

/** 详情页海报：竖版海报里第一张没加载失败的 */
export function detailCover(film: AmaneFilm, failed: string[]): string | null {
  const posters = [film.poster_url, ...(film.poster_urls || [])]
  return posters.find(url => url && !failed.includes(url)) || null
}

/** 详情页信息行（制作商 / 发行商 / 系列），空值不显示 */
export function filmFacts(
  film: AmaneFilm
): { field: string; label: string; value: string }[] {
  return [
    { field: 'studio', label: '制作商', value: film.studio || '—' },
    { field: 'publisher', label: '发行商', value: film.publisher || '—' },
    ...(film.series
      ? [{ field: 'series', label: '系列', value: film.series }]
      : []),
  ].filter(fact => fact.value !== '—')
}

/** 来源链接：只保留 http(s) 地址 */
export function sourceLinks(film: AmaneFilm): { name: string; url: string }[] {
  return Object.entries(film.source_urls || {}).flatMap(([name, raw]) => {
    if (typeof raw !== 'string') return []
    try {
      const url = new URL(raw)
      return ['http:', 'https:'].includes(url.protocol)
        ? [{ name, url: url.href }]
        : []
    } catch {
      return []
    }
  })
}

/** 剧照：优先本地 extrafanart，没有时用各站点的远程剧照；去重并去掉不能加载的 */
export function filmStills(film: AmaneFilm, toImage: ToImage): string[] {
  const primary = film.extrafanart || []
  const images = primary.length
    ? primary
    : Object.values(film.extrafanart_urls || {}).flat()
  return [...new Set(images)].filter(
    image => typeof image === 'string' && toImage(image)
  )
}

/** 循环翻页（剧照预览左右切换） */
export const cycleIndex = (index: number, delta: number, size: number): number =>
  (index + delta + size) % size

/** 用户标签增删后的新列表：移除按 id 过滤；添加时已存在则不重复 */
export function nextUserTags(
  tags: AmaneUserTag[],
  action: 'attach' | 'detach',
  id: number | undefined,
  added?: AmaneUserTag
): AmaneUserTag[] {
  if (action === 'detach') return tags.filter(item => item.id !== id)
  return tags.some(item => item.id === id) ? tags : [...tags, added!]
}

/** 悬停预览的轮播图：去重后的剧照，没有剧照时用封面；去掉加载失败的 */
export function hoverImages(
  film: AmaneFilm,
  failed: string[],
  toImage: ToImage
): string[] {
  const stills = [...new Set((film.extrafanart || []).filter(Boolean))]
  const candidates = stills.length ? stills : [filmCoverSource(film)]
  return candidates
    .filter((url): url is string => Boolean(url))
    .map(url => toImage(url))
    .filter(url => !failed.includes(url))
}

/** 悬停卡尺寸（估计高度用于贴底时上移） */
export const HOVER_CARD = { width: 400, margin: 10, estHeight: 540 }

/**
 * 悬停卡位置：右侧放得下放右侧，否则左侧，再不行居中压在卡片上；
 * 纵向与卡片顶部对齐并夹在视口内。
 */
export function hoverPosition(
  rect: { left: number; right: number; top: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const { width, margin, estHeight } = HOVER_CARD
  const rightRoom = viewport.width - rect.right
  let left: number
  if (rightRoom >= width + margin) left = rect.right + margin
  else if (rect.left >= width + margin) left = rect.left - width - margin
  else
    left = Math.min(
      Math.max(margin, rect.right - width / 2),
      viewport.width - width - margin
    )
  const top = Math.min(
    Math.max(margin, rect.top - 10),
    Math.max(margin, viewport.height - estHeight - margin)
  )
  return { left: Math.round(left), top: Math.round(top) }
}

/** 列表 / 详情里截断显示的名单：超过上限加省略号 */
export function clipList(items: string[], max: number, sep: string): string {
  return `${items.slice(0, max).join(sep)}${items.length > max ? ' …' : ''}`
}
