/**
 * 「继续播放」记录 → 助手结果卡片（封面、看到多少、剩余时间、进度条）。媒体库技能与私密技能共用。
 */
import {
  type ContinueRecord,
  continueRecords,
  metaOf,
  openMediaPlayer,
  progressRatio,
  replayOptions,
} from '@/features/player'

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

/** 一条记录 → 卡片 */
export function continueCard(record: ContinueRecord): AssistantMediaCard {
  const progress = progressRatio(record)
  return {
    id: record.id,
    title: record.title,
    image: record.cover ?? null,
    badge: `看到 ${Math.round(progress * 100)}%`,
    meta: [record.episode, remainingText(record)].filter(Boolean).join(' · '),
    progress,
    playLabel: '继续播放',
    play: () =>
      openMediaPlayer({ ...replayOptions(record), continueAs: metaOf(record) }),
  }
}

/**
 * 最近在看、属于这些板块的记录卡片（最多 {@link CONTINUE_CARDS} 张）。
 * @param include 判断记录所在板块要不要
 */
export function continueCardsWhere(
  include: (section: string) => boolean
): AssistantMediaCard[] {
  return continueRecords()
    .value.filter(record => include(record.section))
    .slice(0, CONTINUE_CARDS)
    .map(continueCard)
}
