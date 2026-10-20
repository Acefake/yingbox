/**
 * 候选打分：标题归一化、相似度、加权打分与阈值判定。
 */
export { normalizeTitle } from './normalize'
export {
  DEFAULT_SCORING_OPTIONS,
  type MatchDecision,
  type MatchQuery,
  type ScoreBreakdown,
  type ScoredCandidate,
  type ScoringOptions,
  type ScoringWeights,
  decide,
  rankCandidates,
} from './score'
export { titleSimilarity } from './similarity'
