/**
 * 统一入口浮层里的搜索：输入框有字（不是界面口令）就即时搜，一份结果列表。
 * - 范围胶囊：全部（默认）/ 本地 / 在线，在电影页 / 剧集页再多一枚「电影」/「剧集」（只搜当前分区）；
 *   私密模式没有胶囊，只搜本地私密分区、不搜在线、不做 AI 增强（沿用私密规则）。网页版没有在线源，也没有「在线」胶囊。
 * - 本地：片名 / 人物 / 规则条件 / 画面 + AI 增强（AI 已配置时，融合去重进同一批本地结果，理由写「AI 理解 · …」）；
 * - 在线：现有在线影视源搜索，本地结果先出，在线结果异步追加在后面（use-entry-online.ts）；
 * - 选中规则见 assistant-entry.ts；打开任何结果前先收起浮层。
 */
import { type ComputedRef, type Ref, computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { LibrarySearch, SearchEntry } from '@/features/library'
import { onlineAvailable } from '@/features/online'
import { isSearchCommand } from '@/utils/search-command'

import { useEntrySelection } from './assistant-entry'
import { librarySearchModule } from './library-search'
import { type EntryOnline, useEntryOnline } from './use-entry-online'

/** 范围胶囊 */
export type EntryScope = 'all' | 'local' | 'online' | 'section'

export interface EntryChip {
  id: EntryScope
  label: string
}

/**
 * 当前可选的范围胶囊（私密模式没有胶囊）。
 * @param section 当前分区名（电影页 / 剧集页），不是则 null
 * @param online 有没有在线源（桌面端）
 */
export function entryChips(
  section: string | null,
  online: boolean,
  isPrivate: boolean
): EntryChip[] {
  if (isPrivate) return []
  return [
    { id: 'all', label: '全部' },
    { id: 'local', label: '本地' },
    ...(online ? [{ id: 'online' as const, label: '在线' }] : []),
    ...(section ? [{ id: 'section' as const, label: section }] : []),
  ]
}

export interface EntrySearch {
  search: LibrarySearch
  online: EntryOnline
  /** 正在搜索（输入框有字且不是口令） */
  searching: ComputedRef<boolean>
  /** 去掉首尾空白的输入 */
  query: ComputedRef<string>
  chips: ComputedRef<EntryChip[]>
  scope: Readonly<Ref<EntryScope>>
  /** 点范围胶囊 */
  pickScope: (id: EntryScope) => void
  /** 本地结果 + 在线结果，按显示顺序 */
  entries: ComputedRef<SearchEntry[]>
  selected: Ref<number>
  move: (delta: 1 | -1) => void
}

/**
 * @param draft 输入框文字
 * @param isPrivate 当前是否私密模式
 * @param askable 能不能问 AI（有「问 AI」行）
 * @param aiReady AI 已配置（做 AI 增强）
 * @param close 收起浮层
 */
export function useEntrySearch(options: {
  draft: Ref<string>
  isPrivate: () => boolean
  askable: boolean
  aiReady: () => boolean
  close: () => void
}): EntrySearch {
  const route = useRoute()
  const { librarySearchScope, librarySectionLabel, useLibrarySearch } =
    librarySearchModule()
  const query = computed(() => options.draft.value.trim())
  const searching = computed(
    () => query.value !== '' && !isSearchCommand(query.value)
  )
  const section = computed(() => librarySectionLabel(route.name?.toString()))
  const chips = computed(() =>
    entryChips(section.value, onlineAvailable(), options.isPrivate())
  )
  const scope = ref<EntryScope>('all')
  // 胶囊不再可选（离开分区页、进入私密）时回到「全部」
  watch(chips, list => {
    if (!list.some(chip => chip.id === scope.value)) scope.value = 'all'
  })

  const localOn = computed(
    () => searching.value && (options.isPrivate() || scope.value !== 'online')
  )
  const onlineOn = computed(
    () =>
      searching.value &&
      !options.isPrivate() &&
      onlineAvailable() &&
      (scope.value === 'all' || scope.value === 'online')
  )

  const search = useLibrarySearch({
    text: () => query.value,
    scope: () =>
      librarySearchScope(
        route.name?.toString(),
        options.isPrivate(),
        scope.value === 'section'
      ),
    open: () => localOn.value,
    ai: () => options.aiReady() && !options.isPrivate(),
    leave: options.close,
  })
  const online = useEntryOnline({
    text: () => query.value,
    enabled: () => onlineOn.value,
    leave: options.close,
  })

  const entries = computed<SearchEntry[]>(() => [
    ...(localOn.value ? search.entries.value : []),
    ...online.rows.value.map(row => ({
      key: `online:${row.key}`,
      exact: false,
      open: () => online.open(row),
    })),
  ])
  const { selected, move } = useEntrySelection(
    () => entries.value,
    () => options.askable,
    () => `${query.value}\n${scope.value}`
  )
  return {
    search,
    online,
    searching,
    query,
    chips,
    scope,
    pickScope: id => {
      scope.value = id
    },
    entries,
    selected,
    move,
  }
}
