/**
 * 「继续播放」记录 → 助手结果卡（海报、进度条、看到哪儿）。媒体库技能与私密技能共用。
 * 片库里的记录补上片库信息（年份 · 类型 · 时长、规格标签、评分，可打开详情 / 加想看），见 card-info.ts。
 */
import type { LibraryCardInfo } from '@/features/library'
import {
  type ContinueRecord,
  continueRecords,
  metaOf,
  openMediaPlayer,
  progressRatio,
  replayOptions,
} from '@/features/player'

import { cardInfos, withLibraryInfo } from './card-info'
import type { AssistantMediaCard } from './skill-types'

/** 继续播放卡片最多几张 */
export const CONTINUE_CARDS = 3

/** 剩余时间的说明 */
function remainingText(record: ContinueRecord): string {
  if (record.nextUp) return '下一集'
  if (!(record.duration > 0)) return ''
  const minutes = Math.max(
    1,
    Math.round((record.duration - record.progress) / 60)
  )
  return `剩 ${minutes} 分钟`
}

/** 记录对应的片库条目 id：片库记录的详情是 { itemId }，在线等其它板块的记录没有 */
export function continueItemId(record: ContinueRecord): number | null {
  if (record.section === 'online') return null
  const itemId = (record.detail as { itemId?: unknown } | undefined)?.itemId
  return typeof itemId === 'number' ? itemId : null
}

/**
 * 一条记录 → 卡片。
 * @param info 片库条目的卡片信息（片库记录才有）
 */
export function continueCard(
  record: ContinueRecord,
  info: LibraryCardInfo | null = null
): AssistantMediaCard {
  const progress = progressRatio(record)
  const card: AssistantMediaCard = {
    id: record.id,
    title: record.title,
    image: info?.watchlist.poster ?? record.cover ?? null,
    meta: '',
    progress,
    progressNote: [record.episode, remainingText(record)]
      .filter(Boolean)
      .join(' · '),
    playLabel: '继续播放',
    play: () =>
      openMediaPlayer({ ...replayOptions(record), continueAs: metaOf(record) }),
  }
  return withLibraryInfo(card, info)
}

/**
 * 最近在看、属于这些板块的记录卡片（最多 {@link CONTINUE_CARDS} 张），片库记录补上片库信息。
 * @param include 判断记录所在板块要不要
 */
export async function continueCardsWhere(
  include: (section: string) => boolean
): Promise<AssistantMediaCard[]> {
  const records = continueRecords()
    .value.filter(record => include(record.section))
    .slice(0, CONTINUE_CARDS)
  const infos = await cardInfos(records.map(continueItemId))
  return records.map((record, i) => continueCard(record, infos[i]))
}
