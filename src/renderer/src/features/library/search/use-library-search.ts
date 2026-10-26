/**
 * 统一入口（搜索与 AI 助手共用的居中浮层）里的片库搜索：召回会话（本地各路 + AI 增强，融合去重）+ 可选中的结果行 + 去向。
 * 结果分三组共享一个键盘索引：最佳匹配（最多 20）、画面时刻（CLIP，最多 8）、人物（只在番号范围）。
 * 打开任何结果前先 leave()（收起浮层），再跳到条目 / 演员，或从画面时间点播放。
 */
import { type ComputedRef, computed } from 'vue'
import { useRouter } from 'vue-router'
import { isSearchCommand } from '@/utils/search-command'
import type { ActorSummary } from '../../../../../shared/library/ipc'
import { playMoment } from '../visual/play-moment'
import { visualSearchSource } from '../visual/visual-source'
import type { SearchHit, SearchScope } from './types'
import { type UnifiedSearchState, useUnifiedSearch } from './use-unified-search'

/** 一行可选中的结果 */
export interface SearchEntry {
  /** 稳定键（补入召回时保留选中） */
  key: string
  /** 片名精确命中 */
  exact: boolean
  open(): void
}

export interface LibrarySearch extends Pick<
  UnifiedSearchState,
  'busy' | 'thinking' | 'message' | 'visualNotice'
> {
  best: ComputedRef<SearchHit[]>
  moments: ComputedRef<SearchHit[]>
  actors: ComputedRef<ActorSummary[]>
  /** 三组结果按显示顺序排成一列 */
  entries: ComputedRef<SearchEntry[]>
  openHit(hit: SearchHit): void
  openMoment(hit: SearchHit): void
  openActor(id: number): void
  /** 能「在海报墙查看」（指定了分区；全库范围不做） */
  canWall: ComputedRef<boolean>
  wall(): void
  /** 能「搜索在线资源」（私密范围不做） */
  canOnline: ComputedRef<boolean>
  online(): void
  /** 画面检索可选 CLIP 范围（索引所在的私密范围） */
  canPickVisual: ComputedRef<boolean>
}

/**
 * 本地片库的搜索范围：私密 → 私密库；「当前分区」胶囊在电影页 / 剧集页 → 本分区；其余 → 全部本地片库。
 * @param routeName 当前路由名
 * @param isPrivate 是否私密模式（私密路由或在播私密内容）
 * @param sectionOnly 只搜当前分区
 */
export function librarySearchScope(
  routeName: string | undefined,
  isPrivate: boolean,
  sectionOnly = false
): SearchScope {
  if (isPrivate) return 'jav'
  if (sectionOnly && routeName === 'Movie') return 'movie'
  if (sectionOnly && routeName === 'TV') return 'tv'
  return 'all'
}

/** 当前页面是片库分区时的名字（「当前分区」胶囊的文字）；不是则 null */
export function librarySectionLabel(
  routeName: string | undefined
): string | null {
  return routeName === 'Movie' ? '电影' : routeName === 'TV' ? '剧集' : null
}

const SECTION_PATHS = { jav: '/jav', tv: '/tv', movie: '/movie' } as const

export function useLibrarySearch(options: {
  text: () => string
  scope: () => SearchScope
  /** 浮层打开、在搜索（有字）且范围包含本地 */
  open: () => boolean
  /** 做 AI 增强（AI 已配置、非私密） */
  ai: () => boolean
  /** 离开浮层（打开结果之前调用） */
  leave: () => void
}): LibrarySearch {
  const router = useRouter()
  const { hits, actors, filter, busy, thinking, message, visualNotice } =
    useUnifiedSearch({
      text: options.text,
      scope: options.scope,
      open: options.open,
      ai: options.ai,
      visualSource: () => visualSearchSource.value,
    })
  const query = (): string => options.text().trim()
  const best = computed(() => hits.value.slice(0, 20))
  const moments = computed(() =>
    hits.value.filter(hit => hit.visual?.frame).slice(0, 8)
  )
  const shownActors = computed(() =>
    options.scope() === 'jav' ? actors.value : []
  )

  function openHit(hit: SearchHit): void {
    const path =
      options.scope() === 'jav'
        ? SECTION_PATHS.jav
        : hit.item.type === 'series'
          ? SECTION_PATHS.tv
          : SECTION_PATHS.movie
    options.leave()
    void router.push({ path, query: { item: String(hit.item.id) } })
  }

  function openMoment(hit: SearchHit): void {
    const frame = hit.visual?.frame
    if (!frame || !hit.visual) return
    options.leave()
    void playMoment(hit.visual.itemId, frame.fileId, frame.at)
  }

  function openActor(id: number): void {
    if (options.scope() !== 'jav') return
    options.leave()
    void router.push({ path: SECTION_PATHS.jav, query: { actor: String(id) } })
  }

  const entries = computed<SearchEntry[]>(() => [
    ...best.value.map(hit => ({
      key: `work:${hit.key}`,
      exact: hit.exact,
      open: () => openHit(hit),
    })),
    ...moments.value.map(hit => ({
      key: `moment:${hit.key}`,
      exact: false,
      open: () => openMoment(hit),
    })),
    ...shownActors.value.map(actor => ({
      key: `actor:${actor.id}`,
      exact: false,
      open: () => openActor(actor.id),
    })),
  ])

  function wall(): void {
    const text = query()
    const scope = options.scope()
    if (!text || isSearchCommand(text) || scope === 'all') return
    options.leave()
    void router.push({
      path: SECTION_PATHS[scope],
      query: {
        q: text,
        searchFilter: JSON.stringify(
          Object.keys(filter.value).length ? filter.value : { keywords: [text] }
        ),
      },
    })
  }

  function online(): void {
    const text = query()
    if (!text || isSearchCommand(text) || options.scope() === 'jav') return
    options.leave()
    void router.push({ path: '/', query: { tab: 'search', q: text } })
  }

  return {
    best,
    moments,
    actors: shownActors,
    entries,
    busy,
    thinking,
    message,
    visualNotice,
    openHit,
    openMoment,
    openActor,
    canWall: computed(() => options.scope() !== 'all'),
    wall,
    canOnline: computed(() => options.scope() !== 'jav'),
    online,
    canPickVisual: computed(() => options.scope() === 'jav'),
  }
}
