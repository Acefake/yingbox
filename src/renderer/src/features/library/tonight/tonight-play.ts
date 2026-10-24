/**
 * 「今晚看什么」的播放与对外入口：面板里点播放、AI 助手里要推荐都走这里。
 *
 * - playTonightPick：在看的按「继续播放」记录续播，其余按条目主播放（电影连播全部文件，剧从第一集）；
 * - suggestTonight：用面板同一套逻辑（useTonight：本地筛候选 → 模型挑 3 部，失败退回本地规则）
 *   推荐一批，并带上卡片要显示的图片与说明。
 */
import { metaOf, openMediaPlayer, replayOptions } from '@/features/player'

import { libraryBridge } from '../api/bridge'
import { itemImage } from '../api/images'
import { play, primaryPlayRequest } from '../detail/playback'
import type { TonightPick } from './tonight-picks'
import { candidateMeta } from './tonight-rules'
import { watchingRecord } from './tonight-source'
import { useTonight } from './use-tonight'

/** 播放一条推荐；找不到可播放文件时返回 false */
export async function playTonightPick(pick: TonightPick): Promise<boolean> {
  const record = watchingRecord(pick.candidate.continueId)
  if (record)
    return openMediaPlayer({
      ...replayOptions(record),
      continueAs: metaOf(record),
    })
  const node = await libraryBridge()?.getItem(pick.candidate.id)
  const request = node ? primaryPlayRequest(node) : null
  if (!node || !request) return false
  return play(request, itemImage(node.poster, 780) ?? undefined)
}

/** 一条推荐加上卡片要显示的内容 */
export interface TonightSuggestion {
  pick: TonightPick
  title: string
  /** 竖版海报（没有时用横版背景图） */
  image: string | null
  /** 时长 / 评分等一行说明 */
  meta: string
  reason: string
  /** 在「继续播放」里（按钮写「继续播放」） */
  resume: boolean
}

/** 一批推荐与提示（AI 未配置 / 出错时 notice 说明退回了本地规则） */
export interface TonightSuggestions {
  suggestions: TonightSuggestion[]
  notice: string | null
}

/**
 * 推荐一批今晚看的片子（只从 TMDB 来源的库与非私密的继续播放里挑）。
 * @param note 用户的一句话要求（心情、类型、时长等，原样交给模型）
 * @param signal 取消
 */
export async function suggestTonight(
  note: string,
  signal?: AbortSignal
): Promise<TonightSuggestions> {
  const tonight = useTonight()
  tonight.note.value = note
  signal?.addEventListener('abort', tonight.cancel, { once: true })
  try {
    await tonight.recommend(true)
  } finally {
    signal?.removeEventListener('abort', tonight.cancel)
  }
  const suggestions = tonight.picks.value.map(pick => ({
    pick,
    title: pick.candidate.title,
    image:
      itemImage(pick.candidate.poster, 300) ??
      itemImage(pick.candidate.backdrop, 780),
    meta: candidateMeta(pick.candidate),
    reason: pick.reason,
    resume: Boolean(pick.candidate.continueId),
  }))
  return { suggestions, notice: tonight.notice.value?.text ?? null }
}
