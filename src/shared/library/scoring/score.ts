/**
 * 候选打分与判定。
 *
 * 总分是几项信号的加权平均，只对两边都有数据的信号计权：
 * - 标题：查询的主/副标题 × 候选的 title / original_title / alternative_titles / translations，
 *   取归一化后相似度的最大值（总是参与）；
 * - 年份：一致 1，差 1 年 0.7，其余 0；
 * - 时长（电影）：相差 ≤5% 或 ≤3 分钟 1，≤15% 0.6，其余 0；
 * - 季 / 集（剧集）：该季存在且集号不超过该季集数 1，季存在但集号超出 0.3，季不存在 0；
 *   绝对集数比对全剧正片总集数。
 * 热度不进分数，只在同分时决定先后。
 */
import type { Candidate, MediaKind } from '../provider'
import { normalizeTitle } from './normalize'
import { titleSimilarity } from './similarity'

/** 打分用的查询，通常由解析结果 + 探测信息组成。 */
export interface MatchQuery {
  kind: MediaKind
  /** 主标题与副标题（中英双标题时两个都给）。 */
  titles: string[]
  year?: number
  /** 电影时长（分钟）。 */
  runtimeMinutes?: number
  season?: number
  episodes?: number[]
  /** 集号是绝对集数。 */
  absolute?: boolean
}

/** 各信号权重。 */
export interface ScoringWeights {
  title: number
  year: number
  runtime: number
  episodes: number
}

/** 打分与判定配置。 */
export interface ScoringOptions {
  /** 不低于此分直接自动匹配。 */
  autoThreshold: number
  /** 不低于此分（且低于自动阈值）进入待确认。 */
  reviewThreshold: number
  /** 待确认时最多给出几个候选。 */
  reviewLimit: number
  weights: ScoringWeights
}

/** 默认配置：≥0.85 自动、0.6–0.85 待确认（前 3）、<0.6 未匹配。 */
export const DEFAULT_SCORING_OPTIONS: ScoringOptions = {
  autoThreshold: 0.85,
  reviewThreshold: 0.6,
  reviewLimit: 3,
  weights: { title: 0.6, year: 0.25, runtime: 0.15, episodes: 0.15 },
}

/** 各信号得分；未参与的信号缺省。 */
export interface ScoreBreakdown {
  title: number
  year?: number
  runtime?: number
  episodes?: number
}

/** 带分数的候选。 */
export interface ScoredCandidate {
  candidate: Candidate
  score: number
  breakdown: ScoreBreakdown
}

/** 判定结果。 */
export type MatchDecision =
  | { status: 'auto'; best: ScoredCandidate; ranked: ScoredCandidate[] }
  | { status: 'review'; candidates: ScoredCandidate[] }
  | { status: 'unmatched'; candidates: ScoredCandidate[] }

/** 同分判定的容差。 */
const TIE_EPSILON = 1e-9

function yearScore(query?: number, candidate?: number): number | undefined {
  if (query === undefined || candidate === undefined) return undefined
  const diff = Math.abs(query - candidate)
  return diff === 0 ? 1 : diff === 1 ? 0.7 : 0
}

function runtimeScore(query?: number, candidate?: number): number | undefined {
  if (!query || !candidate) return undefined
  const diff = Math.abs(query - candidate)
  const ratio = diff / candidate
  if (diff <= 3 || ratio <= 0.05) return 1
  return ratio <= 0.15 ? 0.6 : 0
}

function episodeScore(
  query: MatchQuery,
  candidate: Candidate
): number | undefined {
  const maxEpisode = query.episodes?.length
    ? Math.max(...query.episodes)
    : undefined
  if (query.kind !== 'tv' || maxEpisode === undefined || !candidate.seasons) {
    return undefined
  }
  if (query.absolute || query.season === undefined) {
    const total = candidate.seasons
      .filter(s => s.season > 0)
      .reduce((sum, s) => sum + s.episodeCount, 0)
    return maxEpisode <= total ? 1 : 0
  }
  const season = candidate.seasons.find(s => s.season === query.season)
  if (!season) return 0
  return maxEpisode <= season.episodeCount ? 1 : 0.3
}

/** 候选的全部可比标题。 */
function candidateTitles(c: Candidate): string[] {
  return [
    c.title,
    c.originalTitle,
    ...(c.alternativeTitles ?? []),
    ...(c.translations ?? []),
  ].filter((t): t is string => Boolean(t))
}

/**
 * 给一组候选打分并排序（分数降序，同分按热度降序）。
 * 查询标题只归一化一次；同一候选重复的标题只算一次。
 */
export function rankCandidates(
  query: MatchQuery,
  candidates: Candidate[],
  options: ScoringOptions = DEFAULT_SCORING_OPTIONS
): ScoredCandidate[] {
  const queryTitles = [...new Set(query.titles.map(normalizeTitle))].filter(
    Boolean
  )
  const w = options.weights
  const scored = candidates.map((candidate): ScoredCandidate => {
    const titles = new Set(candidateTitles(candidate).map(normalizeTitle))
    let title = 0
    for (const q of queryTitles) {
      for (const t of titles) title = Math.max(title, titleSimilarity(q, t))
    }
    const breakdown: ScoreBreakdown = { title }
    let total = w.title * title
    let weight = w.title
    const add = (
      key: 'year' | 'runtime' | 'episodes',
      value?: number
    ): void => {
      if (value === undefined) return
      breakdown[key] = value
      total += w[key] * value
      weight += w[key]
    }
    add('year', yearScore(query.year, candidate.year))
    if (query.kind === 'movie') {
      add(
        'runtime',
        runtimeScore(query.runtimeMinutes, candidate.runtimeMinutes)
      )
    }
    add('episodes', episodeScore(query, candidate))
    return { candidate, score: total / weight, breakdown }
  })
  return scored.sort((a, b) =>
    Math.abs(a.score - b.score) > TIE_EPSILON
      ? b.score - a.score
      : (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0)
  )
}

/** 按阈值判定已排序的候选。 */
export function decide(
  ranked: ScoredCandidate[],
  options: ScoringOptions = DEFAULT_SCORING_OPTIONS
): MatchDecision {
  const best = ranked[0]
  if (best && best.score >= options.autoThreshold) {
    return { status: 'auto', best, ranked }
  }
  if (best && best.score >= options.reviewThreshold) {
    return {
      status: 'review',
      candidates: ranked.slice(0, options.reviewLimit),
    }
  }
  return {
    status: 'unmatched',
    candidates: ranked.slice(0, options.reviewLimit),
  }
}
