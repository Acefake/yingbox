/** 统一搜索的查询、召回与命中证据；召回器只返回库内真实条目。 */
import type {
  ActorSummary,
  LibraryItemSummary,
  LibraryQuery,
  VisualHit,
  VisualSearchSource,
} from '../../../../../shared/library/ipc'
import type { NlFilter } from '../nl-search/nl-filter'
import type { LibrarySection } from '../state/library-section'

export type SearchScope = LibrarySection | 'all'
/** ai = AI 把这句话解析成条件后再按条件召回 */
export type RecallKind = 'title' | 'people' | 'conditions' | 'visual' | 'ai'
export interface SearchRequest {
  text: string
  scope: SearchScope
  visualSource?: VisualSearchSource
  filter?: NlFilter
  signal: AbortSignal
}
export interface SearchCandidate {
  item: LibraryItemSummary
  reason: string
  exact?: boolean
  visual?: VisualHit
}
export interface RecallBatch {
  kind: RecallKind
  candidates: SearchCandidate[]
  actors?: ActorSummary[]
  message?: string
}
export interface RecallContext extends SearchRequest {
  base: LibraryQuery
  weights: Record<RecallKind, number>
}
export interface SearchHit {
  key: string
  item: LibraryItemSummary
  versions: LibraryItemSummary[]
  score: number
  exact: boolean
  reasons: string[]
  visual?: VisualHit
}
export type SearchRecall = (request: RecallContext) => Promise<RecallBatch>
