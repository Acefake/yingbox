/**
 * 详情页（Apple TV 式，效果图 D-1 / D-2 / D-3）视图层的纯规则：头图规格行与标签、主创行、
 * 底部胶囊的页内分区、滚动时哪个分区算当前。不依赖 Vue，便于单测；数据规则仍在 detail-rules.ts。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { type SpecBadge, videoRangeSpec } from '@/components/ui/spec-badge'

import type { TitleMeta } from './detail-rules'

/**
 * 头图规格行：信息行去掉分级（分级改成圆标，见 heroSpecsOf）。
 * @param metaLine metaLineOf 的结果
 * @param meta 标题级元数据
 */
export function heroMetaParts(
  metaLine: string[],
  meta: TitleMeta | null
): string[] {
  const cert = meta?.certification
  return cert ? metaLine.filter(part => part !== cert) : metaLine
}

/**
 * 头图规格标签：分级圆标（不超过 3 个字符，如 16+；更长的如 PG-13 用描边方块）+ 动态范围标签。
 * @param node 条目
 * @param meta 标题级元数据
 */
export function heroSpecsOf(
  node: Pick<LibraryItemNode, 'videoRange'>,
  meta: TitleMeta | null
): SpecBadge[] {
  const out: SpecBadge[] = []
  const cert = meta?.certification?.trim()
  if (cert) {
    out.push({ variant: cert.length <= 3 ? 'rating' : 'outline', text: cert })
  }
  const range = videoRangeSpec(node.videoRange)
  if (range) out.push(range)
  return out
}

/** 头图下方的一行主创（「主演 张鲁一、于和伟、陈瑾」）。 */
export interface CreditLine {
  label: string
  names: string
}

/**
 * 主创行：主演取演员表前 3 位，导演（剧集没有导演时取主创）全部列出；没有的行不出。
 * @param meta 标题级元数据
 */
export function creditLinesOf(meta: TitleMeta | null): CreditLine[] {
  if (!meta) return []
  const lines: CreditLine[] = []
  const cast = meta.cast.slice(0, 3).map(p => p.name)
  if (cast.length) lines.push({ label: '主演', names: cast.join('、') })
  const pick = (job: string): string[] => [
    ...new Set(meta.crew.filter(p => p.job === job).map(p => p.name)),
  ]
  const directors = pick('Director')
  const creators = directors.length ? [] : pick('Creator')
  if (directors.length) {
    lines.push({ label: '导演', names: directors.join('、') })
  } else if (creators.length) {
    lines.push({ label: '主创', names: creators.join('、') })
  }
  return lines
}

/** 页内分区（底部胶囊导航的一项） */
export type DetailTabKey =
  | 'overview'
  | 'episodes'
  | 'stills'
  | 'cast'
  | 'versions'
  | 'about'

export interface DetailTab {
  key: DetailTabKey
  label: string
}

const TAB_LABELS: Record<DetailTabKey, string> = {
  overview: '概览',
  episodes: '剧集',
  stills: '剧照',
  cast: '演职员',
  versions: '版本',
  about: '关于',
}

/**
 * 底部胶囊的分区：概览与关于总在，其余按详情里实际有的区块出现，顺序与页面一致。
 * @param present 各区块是否显示
 */
export function detailTabsOf(
  present: Partial<Record<DetailTabKey, boolean>>
): DetailTab[] {
  const order: DetailTabKey[] = [
    'overview',
    'episodes',
    'stills',
    'cast',
    'versions',
    'about',
  ]
  return order
    .filter(key => key === 'overview' || key === 'about' || present[key])
    .map(key => ({ key, label: TAB_LABELS[key] }))
}

/**
 * 当前分区：顶边已越过视口上方 anchor 处的最后一个区块；滚到底时取最后一个（最后一块往往不够高）。
 * @param sections 区块与它相对滚动内容顶部的位置，按页面顺序
 * @param scrollTop 滚动位置
 * @param viewport 视口高度
 * @param scrollHeight 内容总高
 * @param anchor 视口里的判定线（距顶部的比例），默认 0.45
 */
export function activeTabAt(
  sections: Array<{ key: DetailTabKey; top: number }>,
  scrollTop: number,
  viewport: number,
  scrollHeight: number,
  anchor = 0.45
): DetailTabKey | null {
  if (!sections.length) return null
  if (scrollTop + viewport >= scrollHeight - 2) return sections.at(-1)!.key
  const line = scrollTop + viewport * anchor
  let current = sections[0].key
  for (const section of sections) {
    if (section.top <= line) current = section.key
    else break
  }
  return current
}
