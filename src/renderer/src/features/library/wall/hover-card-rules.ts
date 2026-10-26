/**
 * 海报悬停详情卡的纯规则：卡片放在格子哪一侧、卡片上显示哪些信息。
 *
 * 位置：优先放在格子右侧，右边放不下放左侧，两边都放不下就压在格子上（水平居中对齐）；
 * 纵向与格子顶边对齐，超出视口时收回视口内。信息从条目详情树里取（番号库：制作商 / 系列 / 导演 / 演员 / 标签）。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { titleMetaOf } from '../detail/detail-rules'
import { formatRating } from '../../../../../shared/library/rating'

/** 卡片尺寸（与 hover-card.css 一致）。 */
export const HOVER_CARD = { width: 340, maxHeight: 460, gap: 12, margin: 8 }

/** 悬停多久弹出、离开多久收起（毫秒）。 */
export const HOVER_DELAY = { show: 420, hide: 180 } as const

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
}

/** 卡片左上角（视口坐标）。 */
export function hoverCardPosition(
  cell: Rect,
  viewport: { width: number; height: number },
  card = HOVER_CARD
): { left: number; top: number } {
  const { width, maxHeight, gap, margin } = card
  let left: number
  if (cell.right + gap + width + margin <= viewport.width) {
    left = cell.right + gap
  } else if (cell.left - gap - width >= margin) {
    left = cell.left - gap - width
  } else {
    left = cell.left + (cell.width - width) / 2
  }
  left = Math.max(margin, Math.min(left, viewport.width - width - margin))
  const top = Math.max(
    margin,
    Math.min(cell.top, viewport.height - maxHeight - margin)
  )
  return { left: Math.round(left), top: Math.round(top) }
}

/** 名单截短：超过 max 个时末尾加「等 N 位」。 */
export function clipList(names: string[], max: number, sep: string): string {
  if (names.length <= max) return names.join(sep)
  return `${names.slice(0, max).join(sep)}${sep}等 ${names.length} 个`
}

/** 卡片要显示的信息。 */
export interface HoverFacts {
  /** 信息行：日期、时长、评分、文件数。 */
  meta: string[]
  /** 键值行。 */
  rows: Array<{ label: string; value: string; wrap?: boolean }>
  overview: string | null
}

/** 条目详情 → 卡片信息。 */
export function hoverFactsOf(node: LibraryItemNode): HoverFacts {
  const meta = titleMetaOf(node)
  const date = node.airDate ?? meta?.releaseDate ?? null
  const fileCount = node.files.filter(f => f.kind === 'video').length
  const rating = formatRating(node.rating, node.ratingSource)
  const line = [
    date ? date.slice(0, 10) : node.year ? String(node.year) : '',
    node.runtime ? `${node.runtime} 分钟` : '',
    rating ? `★ ${rating}` : '',
    fileCount > 1 ? `${fileCount} 个文件` : '',
  ].filter(Boolean)
  const rows: HoverFacts['rows'] = []
  const push = (
    label: string,
    value: string | undefined,
    wrap = false
  ): void => {
    if (value) rows.push({ label, value, wrap })
  }
  if (meta) {
    if (meta.ref?.provider === 'jav') {
      push('制作商', meta.companies[0])
      push('发行商', meta.companies[1])
    } else {
      push('出品', meta.companies.slice(0, 2).join('、'))
    }
    push('系列', meta.collection?.name)
    const directors = meta.crew
      .filter(p => p.job === 'Director')
      .map(p => p.name)
    push('导演', clipList(directors, 4, ' / '), true)
    push(
      '演员',
      clipList(
        meta.cast.map(p => p.name),
        8,
        ' / '
      ),
      true
    )
  }
  push('标签', clipList(node.genres, 10, ' · '), true)
  return { meta: line, rows, overview: node.overview }
}
