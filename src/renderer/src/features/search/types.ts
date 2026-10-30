import type { ComputedRef, Ref } from 'vue'
import type { ProviderKind } from './session'
import type { LibraryItemSummary } from '../../../../shared/library/ipc'
import type { CmsItem } from '@/features/online'
import type {
  MagnetItem,
  NetdiskItem,
} from '../../../../shared/contract/pan115'

export type ResourceKind = 'local' | 'online' | 'share' | 'magnet'
export type WorkKind = 'movie' | 'series'
export interface SearchQuery {
  text: string
  keyword: string
  year?: number
  season?: number
  episode?: number
  resolution?: string
}
export interface SearchResource {
  key: string
  kind: ResourceKind
  title: string
  workTitle: string
  aliases?: string[]
  year?: number
  type?: WorkKind
  tmdbId?: string
  image?: string | null
  sources: string[]
  reason: string
  interpreted?: boolean
  local?: LibraryItemSummary
  online?: CmsItem
  share?: NetdiskItem
  magnet?: MagnetItem
}
export interface SearchWork {
  key: string
  title: string
  year?: number
  type?: WorkKind
  image?: string | null
  resources: SearchResource[]
  possible: boolean
  score: number
}
export interface SourceState {
  status: 'idle' | 'loading' | 'done' | 'error' | 'unconfigured'
  count: number
  message: string
}
export interface OnlineProvider {
  available: boolean
  search(
    keyword: string,
    signal: AbortSignal,
    publish: (items: SearchResource[]) => void
  ): Promise<string>
  open(resource: SearchResource): Promise<void>
}
export interface SearchEnhancement {
  keywords: string[]
  resources: SearchResource[]
  message: string
}

export interface ResourceSearch {
  resources: Ref<SearchResource[]>
  states: Ref<Record<ProviderKind, SourceState> | undefined>
  works: ComputedRef<SearchWork[]>
  query: ComputedRef<SearchQuery>
  busy: ComputedRef<boolean>
  more: Ref<boolean>
  moreBusy: Ref<boolean>
  loadMore(): Promise<void>
  retry(kind: ProviderKind): Promise<void>
  run(): Promise<void>
  online: OnlineProvider
}
