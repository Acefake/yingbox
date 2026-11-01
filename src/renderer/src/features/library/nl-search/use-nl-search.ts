/**
 * 媒体库的自然语言搜索：读顶栏搜索框（路由 ?q=），像一句描述（或 ? 前缀、点了「AI 理解」）时
 * 交给 chatJson 解析成条件，叠加到海报墙查询上；普通关键词仍走片名搜索。
 *
 * - 输入停 600ms 再调模型，新输入会取消旧请求；同一分区同一个问题的解析结果缓存。
 * - 解析中保留上一次的结果，不闪全库；AI 未配置 / 失败时退回片名搜索并给出提示。
 * - 番号页（私密分区）请求带 private: true；从 AI 助手的私密模式跳来（路由带 localOnly=1）时再带 localOnly，
 *   不看「私密板块只用本地模型」设置，只发给本地模型。
 * - 条件里有类型而本库类型信息不全时，再问一次模型「按片名判断」（nl-title-pick-run.ts，隐私设置同上）；
 *   查询范围（媒体库、匹配筛选等）变了就重新判断。
 * 规则在 nl-rules.ts / nl-chips.ts / nl-filter.ts / nl-title-pick.ts。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'

import type { LibraryQuery } from '../../../../../shared/library/ipc'
import {
  AiCallError,
  aiAvailable,
  aiConfigured,
  aiKeyConfigured,
  chatJson,
} from '@/features/ai'
import { continueRecords } from '@/features/player'
import { useSetting } from '@/features/settings'

import { libraryBridge } from '../api/bridge'
import { filterReader } from '../search/route-filter'
import { type LibrarySection, recordSectionsOf } from '../state/library-section'
import {
  type NlChip,
  editChip,
  nlChips,
  removeChip,
  toggleChip,
} from './nl-chips'
import {
  NL_FILTER_SCHEMA,
  type NlFilter,
  isEmptyFilter,
  nlSystemPrompt,
  sanitizeNlFilter,
} from './nl-filter'
import {
  NlCache,
  type NlQueryContext,
  applyNlFilter,
  cacheKey,
  isPrivateSection,
  nlIntent,
} from './nl-rules'
import { type TitlePick, titlePickScope } from './nl-title-pick'
import { runTitlePick } from './nl-title-pick-run'

/** 输入停多久再调模型。 */
const AI_DELAY_MS = 600
/** 类型取值最多取多少个给模型挑。 */
const GENRE_LIMIT = 80

/** 进行状态：idle 没走 AI；loading 解析中；done 已解析；error 失败；unconfigured 没配置。 */
export type NlStatus = 'idle' | 'loading' | 'done' | 'error' | 'unconfigured'

/** 全应用共用一份缓存（切页面回来不重新问）。 */
const cache = new NlCache<NlFilter>()
/** 按片名判断生效时的说明。 */
const PICK_NOTE = '本库类型信息不全，已让 AI 按片名判断'

export interface NlSearch {
  /** 交给海报墙的片名搜索词（走 AI 时为空，或退回时是原句） */
  search: ComputedRef<string>
  /** 当前是自然语言问题（显示条件条） */
  active: ComputedRef<boolean>
  /** 有普通关键词，可以点「AI 理解」 */
  canAsk: ComputedRef<boolean>
  status: Ref<NlStatus>
  /** 失败 / 未配置的说明 */
  message: Ref<string>
  chips: ComputedRef<NlChip[]>
  /** 条件变化的比较键（清空多选、回顶部） */
  key: ComputedRef<string>
  /** 走 AI 且没结果时的空状态标题；null 用默认文案 */
  emptyTitle: ComputedRef<string | null>
  /** 在基础查询上叠加当前条件 */
  apply: (query: LibraryQuery) => LibraryQuery
  /** 海报墙的完整查询：基础查询 + 当前条件（响应式 getter） */
  query: () => LibraryQuery
  /** 强制用 AI 理解当前文字 / 失败后重试 */
  ask: () => void
  remove: (chip: NlChip) => void
  toggle: (chip: NlChip) => void
  /** 用文字改胶囊；认不出返回 false */
  edit: (chip: NlChip, text: string) => boolean
  openSettings: () => void
}

/**
 * @param section 当前分区
 * @param baseQuery 海报墙的基础查询（分区、匹配筛选、媒体库、排序、片名搜索）
 */
export function useNlSearch(
  section: LibrarySection,
  baseQuery: () => LibraryQuery
): NlSearch {
  const route = useRoute()
  const provider = useSetting('ai.provider')
  const baseUrl = useSetting('ai.baseUrl')
  const model = useSetting('ai.model')
  const records = continueRecords()

  const text = computed(() =>
    typeof route.query.q === 'string' ? route.query.q : ''
  )
  /** 点过「AI 理解」的那段文字（文字变了就失效） */
  const forcedFor = ref<string | null>(null)
  const transferred = computed(filterReader(() => route.query.searchFilter))
  const intent = computed(() =>
    transferred.value
      ? { kind: 'plain' as const, text: text.value }
      : nlIntent(text.value, forcedFor.value === text.value)
  )
  const status = ref<NlStatus>('idle')
  const message = ref('')
  /** 当前生效的条件；null 表示没在用 AI 条件 */
  const filter = shallowRef<NlFilter | null>(null)
  /** 当前生效的片名搜索词 */
  const plain = ref('')
  const genres = shallowRef<string[] | null>(null)
  /** 按片名判断的结果（只在类型与当前条件一致时生效） */
  const titlePick = shallowRef<TitlePick | null>(null)

  const ready = (): boolean =>
    aiConfigured({
      available: aiAvailable(),
      provider: provider.value,
      baseUrl: baseUrl.value,
      model: model.value,
      keyConfigured: aiKeyConfigured(provider.value),
    })

  const recordSections: readonly string[] = recordSectionsOf(section)
  const watchedIds = computed(() =>
    records.value
      .filter(r => recordSections.includes(r.section) && /^\d+$/.test(r.key))
      .map(r => Number(r.key))
  )

  async function loadGenres(): Promise<string[]> {
    if (genres.value) return genres.value
    const api = libraryBridge()?.facets
    const source = section === 'jav' ? 'jav' : 'tmdb'
    const list = api
      ? await api
          .list({ field: 'tag', source, limit: GENRE_LIMIT })
          .catch(() => [])
      : []
    genres.value = list.map(v => v.value)
    return genres.value
  }

  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel(): void {
    clearTimeout(timer)
    controller?.abort()
    controller = null
  }

  /** 退回片名搜索并说明原因。 */
  function fallback(question: string, next: NlStatus, why: string): void {
    filter.value = null
    titlePick.value = null
    plain.value = question
    status.value = next
    message.value = why
  }

  /** 两次模型请求共用的隐私选项（私密分区带 private，必要时只发本地模型）。 */
  const privacy = (): { private: boolean; localOnly?: true } => ({
    private: isPrivateSection(section),
    ...(isPrivateSection(section) && route.query.localOnly === '1'
      ? { localOnly: true as const }
      : {}),
  })

  const context = (pick: TitlePick | null = null): NlQueryContext => ({
    section,
    genres: genres.value ?? [],
    watchedIds: watchedIds.value,
    titlePick: pick,
  })

  /** 本库类型信息不全时按片名判断；失败保留类型筛选（只提示）。 */
  async function pickByTitle(
    question: string,
    parsed: NlFilter,
    signal: AbortSignal
  ): Promise<TitlePick | null> {
    try {
      return await runTitlePick({
        key: cacheKey(section, question),
        question,
        parsed,
        base: baseQuery(),
        ctx: context(),
        privacy: privacy(),
        signal,
      })
    } catch {
      if (!signal.aborted) message.value = '按片名判断失败，先按类型筛选'
      return null
    }
  }

  /** 换上按片名判断的结果（提示跟着换；不覆盖失败提示）。 */
  function usePick(pick: TitlePick | null): void {
    titlePick.value = pick
    if (pick) message.value = PICK_NOTE
    else if (message.value === PICK_NOTE) message.value = ''
  }

  /** 让一组条件生效（含按片名判断的结果）。 */
  function settle(parsed: NlFilter, pick: TitlePick | null): void {
    filter.value = parsed
    plain.value = ''
    status.value = 'done'
    usePick(pick)
  }

  async function parse(question: string): Promise<void> {
    const key = cacheKey(section, question)
    controller = new AbortController()
    const signal = controller.signal
    const hit = cache.get(key)
    if (hit) {
      const pick = await pickByTitle(question, hit, signal)
      if (!signal.aborted) settle(hit, pick)
      return
    }
    try {
      const vocabulary = await loadGenres()
      const result = await chatJson(
        {
          messages: [
            {
              role: 'system',
              content: nlSystemPrompt(vocabulary, new Date().getFullYear()),
            },
            { role: 'user', content: question },
          ],
          schema: NL_FILTER_SCHEMA,
          schemaName: 'library_filter',
          temperature: 0,
          maxTokens: 400,
          ...privacy(),
        },
        { signal }
      )
      if (signal.aborted) return
      const parsed = sanitizeNlFilter(result.data)
      if (isEmptyFilter(parsed)) {
        fallback(question, 'error', '没能理解这句话，先按片名搜索')
        return
      }
      cache.set(key, parsed)
      const pick = await pickByTitle(question, parsed, signal)
      if (!signal.aborted) settle(parsed, pick)
    } catch (error) {
      if (signal.aborted) return
      const err = error instanceof AiCallError ? error : null
      if (err?.code === 'cancelled') return
      if (err?.code === 'not_configured')
        fallback(question, 'unconfigured', '还没有配置 AI，先按片名搜索')
      else if (err?.code === 'private_blocked')
        fallback(question, 'unconfigured', `${err.message}，先按片名搜索`)
      else
        fallback(
          question,
          'error',
          `AI 理解失败：${err?.message ?? String(error)}`
        )
    }
  }

  function start(question: string): void {
    if (!ready()) {
      fallback(question, 'unconfigured', '还没有配置 AI，先按片名搜索')
      return
    }
    status.value = 'loading'
    message.value = ''
    timer = setTimeout(() => void parse(question), AI_DELAY_MS)
  }

  watch(
    [intent, transferred],
    ([next, incoming], previous) => {
      cancel()
      if (incoming) {
        if (incoming === previous?.[1]) return
        void loadGenres()
        filter.value = incoming
        titlePick.value = null
        plain.value = ''
        status.value = 'done'
        message.value = ''
        return
      }
      if (next.kind === 'ai') {
        start(next.question)
        return
      }
      filter.value = null
      titlePick.value = null
      status.value = 'idle'
      message.value = ''
      plain.value = next.kind === 'plain' ? next.text : ''
    },
    { immediate: true }
  )
  // 查询范围（媒体库、匹配筛选等）变了：旧的按片名判断结果不再适用，重新判断
  watch(
    () => titlePickScope(baseQuery()),
    () => {
      const parsed = filter.value
      const now = intent.value
      if (!parsed?.genres?.length || now.kind !== 'ai') return
      if (status.value !== 'done') return
      cancel()
      controller = new AbortController()
      const signal = controller.signal
      void pickByTitle(now.question, parsed, signal).then(pick => {
        if (!signal.aborted) usePick(pick)
      })
    }
  )
  onScopeDispose(cancel)

  const active = computed(
    () => transferred.value !== null || intent.value.kind === 'ai'
  )
  const chips = computed(() =>
    filter.value ? nlChips(filter.value, section) : []
  )

  const apply = (query: LibraryQuery): LibraryQuery =>
    filter.value
      ? applyNlFilter(query, filter.value, context(titlePick.value))
      : query

  return {
    search: computed(() => plain.value),
    active,
    canAsk: computed(
      () => transferred.value === null && intent.value.kind === 'plain'
    ),
    status,
    message,
    chips,
    key: computed(() => JSON.stringify(filter.value)),
    emptyTitle: computed(() =>
      filter.value ? '没有符合这些条件的条目' : null
    ),
    apply,
    query: () => apply(baseQuery()),
    ask() {
      if (intent.value.kind === 'ai') {
        cancel()
        start(intent.value.question)
      } else forcedFor.value = text.value
    },
    remove(chip) {
      if (filter.value) filter.value = removeChip(filter.value, chip)
    },
    toggle(chip) {
      if (filter.value) filter.value = toggleChip(filter.value, chip)
    },
    edit(chip, value) {
      if (!filter.value) return false
      const next = editChip(filter.value, chip, value)
      if (!next) return false
      filter.value = next
      return true
    },
    openSettings() {
      window.dispatchEvent(
        new CustomEvent('app:open-settings', { detail: 'ai' })
      )
    },
  }
}
