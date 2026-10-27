/**
 * 追更的纯规则 · 分享标题：看快照之前，先凭 PanSou 给的分享标题判断这个分享和要找的那一集的关系，
 * 明确是别的集 / 别的季 / 别的剧的分享直接丢掉，不花 115 快照次数。
 *
 * 集号 / 季号的关系复用网盘页的 `episodeHint`（`src/shared/netdisk/episode-hint.ts`：exact / covers /
 * unknown / other）；这里只多一条追更才需要的判断：标题写的是别的剧。
 */
import { parseMediaPath } from '../../shared/library/parser'
import {
  type EpisodeHint,
  episodeHint,
} from '../../shared/netdisk/episode-hint'
import { type EpisodeTarget, seriesTitleMatches } from './match-rules'

/**
 * 标题明确写的是别的剧：没提到剧名 / 原名，且标题按单集解析出一个像样的剧名（≥2 字），
 * 如找「繁花」时的「庆余年 S02E05」。只写了画质、「电视剧合集」之类认不出剧名的标题不算。
 */
export function otherSeries(title: string, target: EpisodeTarget): boolean {
  if (!title.trim() || seriesTitleMatches(title, target)) return false
  const parsed = parseMediaPath(title)
  if (parsed.type !== 'episode') return false
  const name = parsed.title.replace(/[\s\p{P}\p{S}]+/gu, '')
  return name.length >= 2
}

/** 分享标题与这一集的关系（别的剧也算 other） */
export function shareHint(title: string, target: EpisodeTarget): EpisodeHint {
  if (otherSeries(title, target)) return 'other'
  return episodeHint(title, target)
}
