/**
 * 结果卡与在线结果行 → 影片结果行（UiMediaRow）的显示数据（纯规则）。
 *
 * - 结果卡的备注：看到哪儿、状态字（未入库…）、推荐理由、来源，空的跳过；
 * - 在线结果行：分类与更新进度（「更新至 12 集」）作说明，各源备注里认出的清晰度作规格标签
 *   （spec-badge.ts 的 releaseSpecs，认不出不显示），来源写「在线 · 源名 等 N 个源」。
 */
import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'

import type { AssistantMediaCard } from './skills/skill-types'
import type { OnlineRow } from './use-entry-online'

/** 卡片备注的几段 */
export function cardNote(card: AssistantMediaCard): string[] {
  return [card.progressNote, card.tag?.(), card.reason, card.source].filter(
    (part): part is string => Boolean(part)
  )
}

/** 卡片的主按钮：有进度是「继续」，否则「播放」 */
export function cardPlayLabel(card: AssistantMediaCard): '继续' | '播放' {
  return card.progress === undefined ? '播放' : '继续'
}

/** 在线结果的来源说明 */
export function onlineSource(row: Pick<OnlineRow, 'sources'>): string {
  const [first] = row.sources
  if (!first) return '在线'
  return row.sources.length > 1
    ? `在线 · ${first} 等 ${row.sources.length} 个源`
    : `在线 · ${first}`
}

/** 备注里的更新进度（「更新至 12 集」「全 30 集」「已完结」） */
const EPISODE_REMARK = /集|完结/

/** 一行在线结果的显示数据 */
export function onlineRowView(row: OnlineRow): {
  meta: string[]
  specs: SpecBadge[]
  note: string[]
} {
  const episodes = row.remarks.find(remark => EPISODE_REMARK.test(remark))
  return {
    meta: [row.type, episodes ?? ''].filter(Boolean),
    specs: releaseSpecs(row.remarks),
    note: [onlineSource(row)],
  }
}
