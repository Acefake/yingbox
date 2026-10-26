/**
 * 详情页（Apple TV 式，效果图 D-1 / D-2 / D-3）视图层的纯规则：头图规格行与标签、主创行、
 * 底部胶囊的页内分区、滚动时哪个分区算当前。不依赖 Vue，便于单测；数据规则仍在 detail-rules.ts。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { type SpecBadge, videoRangeSpec } from '@/components/ui/spec-badge'

import type { TitleMeta } from './detail-rules'

/**
 * 头图规格行：信息行去掉分级（分级以圆标显示，见 heroSpecsOf）。两边都去空白再比，
 * 与 heroSpecsOf 的归一化一致，避免分级文字与圆标同时出现。
 * @param metaLine metaLineOf 的结果
 * @param meta 标题级元数据
 */
export function heroMetaParts(
  metaLine: string[],
  meta: TitleMeta | null
): string[] {
  const cert = meta?.certification?.trim()
  return cert ? metaLine.filter(part => part.trim() !== cert) : metaLine
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

/** 分区在页面里的顺序 */
const TAB_ORDER: DetailTabKey[] = [
  'overview',
  'episodes',
  'stills',
  'cast',
  'versions',
  'about',
]

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
  return TAB_ORDER.filter(
    key => key === 'overview' || key === 'about' || present[key]
  ).map(key => ({ key, label: TAB_LABELS[key] }))
}

/**
 * 当前分区：顶边已越过视口上方 anchor 处的最后一个区块；可滚动且滚到底时取最后一个
 * （最后一块往往不够高）。内容不足一屏时不算「到底」，按 anchor 判定。
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
  const scrollable = scrollHeight - viewport > 2
  if (scrollable && scrollTop + viewport >= scrollHeight - 2) {
    return sections.at(-1)!.key
  }
  const line = scrollTop + viewport * anchor
  let current = sections[0].key
  for (const section of sections) {
    if (section.top <= line) current = section.key
    else break
  }
  return current
}

/**
 * 分区列表变化后（后台刷新让某个区块消失）校正当前分区：还在就不动，否则取页面顺序里它前面最近的一个，
 * 都没有时取第一个。
 * @param tabs 当前的分区列表
 * @param current 当前选中的分区
 */
export function keepTab(
  tabs: DetailTab[],
  current: DetailTabKey
): DetailTabKey {
  if (!tabs.length || tabs.some(tab => tab.key === current)) return current
  const rank = TAB_ORDER.indexOf(current)
  const before = tabs.filter(tab => TAB_ORDER.indexOf(tab.key) < rank)
  return (before.at(-1) ?? tabs[0]).key
}

/** 浮动控件身后是不是 Hero 的深色画面（见 heroBackdropAt） */
export interface HeroBackdrop {
  /** 顶部一条（渐隐带、返回圆钮、窗口键胶囊）身后 */
  edge: boolean
  /** 侧栏身后：Hero 还占着窗口上半截 */
  sidebar: boolean
}

/**
 * 按 Hero 深色画面的下沿（浅色主题下是渐隐段的起点）判断浮动控件身后是深色画面还是页面底色。
 * 渐隐段一进入顶部带就算离开，顶部一条控件不压在半透明的过渡色上；侧栏纵贯整个窗口，画面占不到一半就回主题玻璃。
 * @param mediaBottom 深色画面下沿距滚动容器可视区顶部的距离（px，可为负）
 * @param viewportHeight 滚动容器可视高度
 * @param edgeHeight 顶部渐隐带高度
 */
export function heroBackdropAt(
  mediaBottom: number,
  viewportHeight: number,
  edgeHeight: number
): HeroBackdrop {
  return {
    edge: mediaBottom > edgeHeight,
    sidebar: mediaBottom > viewportHeight / 2,
  }
}
