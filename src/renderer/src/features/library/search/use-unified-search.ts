/**
 * 搜索会话：输入即取消旧查询，停 120ms 后并行召回（片名 / 人物 / 规则条件 / 画面）；所有异步更新绑定同一世代。
 * AI 增强（options.ai() 为真、这句话像自然语言、不是私密范围）：本地结果先出，再停 {@link AI_DELAY_MS}
 * 把这句话交给模型解析成条件（ai-conditions.ts），按条件召回一批 kind 'ai' 的候选，与本地各路一起加权融合、
 * 按作品去重，理由写「AI 理解 · 条件…」。AI 未配置、失败或停止都只留本地结果。
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
import { isSearchCommand } from '@/utils/search-command'
import type {
  ActorSummary,
  VisualSearchSource,
} from '../../../../../shared/library/ipc'
import { errorText } from '../api/bridge'
import { nlChips } from '../nl-search/nl-chips'
import type { NlFilter } from '../nl-search/nl-filter'
import { looksNatural } from '../nl-search/nl-rules'
import { enhanceConditions } from './ai-conditions'
import { recallConditions } from './recall/conditions'
import { fuseSearch, routeSearch, ruleFilter } from './search-rules'
import { searchAvailable, searchLibrary } from './search-service'
import type { RecallBatch, SearchHit, SearchRecall, SearchScope } from './types'

/** 本地召回开始后再等多久才调模型（继续打字就取消，不为每个字发请求） */
export const AI_DELAY_MS = 450

/** AI 条件的理由文字：「AI 理解 · 科幻 · 2000 年代」 */
export function aiReason(filter: NlFilter, scope: SearchScope): string {
  const section =
    scope === 'all' ? (filter.type === 'series' ? 'tv' : 'movie') : scope
  const labels = nlChips(filter, section)
    .map(chip => chip.label)
    .slice(0, 3)
  return ['AI 理解', ...labels].join(' · ')
}

/** 按 AI 条件召回：复用条件召回，记作 ai 一路并写上理由 */
const recallAi =
  (reason: string): SearchRecall =>
  async request => {
    const batch = await recallConditions(request)
    return {
      kind: 'ai',
      candidates: batch.candidates.map(candidate => ({ ...candidate, reason })),
    }
  }

export interface UnifiedSearchState {
  hits: ComputedRef<SearchHit[]>
  actors: ComputedRef<ActorSummary[]>
  /** 本次查询的规则条件（交给海报墙） */
  filter: Ref<NlFilter>
  busy: Ref<boolean>
  /** AI 正在理解这句话（本地结果已可用） */
  thinking: Ref<boolean>
  message: Ref<string>
  visualNotice: Ref<string>
  run(): Promise<void>
  stop(): void
}

export function useUnifiedSearch(options: {
  text: () => string
  scope: () => SearchScope
  open: () => boolean
  /** 做 AI 增强（AI 已配置、非私密） */
  ai?: () => boolean
  visualSource?: () => VisualSearchSource
}): UnifiedSearchState {
  const batches = shallowRef<RecallBatch[]>([])
  const filter = shallowRef<NlFilter>({})
  const busy = ref(false)
  const thinking = ref(false)
  const message = ref('')
  const visualNotice = ref('')
  let generation = 0
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let aiTimer: ReturnType<typeof setTimeout> | undefined

  const hits = computed(() =>
    fuseSearch(batches.value, routeSearch(options.text()))
  )
  const actors = computed(
    () => batches.value.find(batch => batch.kind === 'people')?.actors ?? []
  )

  function stop(): void {
    generation++
    clearTimeout(timer)
    clearTimeout(aiTimer)
    controller?.abort()
    controller = null
    busy.value = false
    thinking.value = false
  }

  /** 换上一路结果（同 kind 覆盖） */
  function put(batch: RecallBatch): void {
    batches.value = [
      ...batches.value.filter(value => value.kind !== batch.kind),
      batch,
    ]
  }

  /** 本地结果出来之后再让 AI 理解；失败只提示，不动本地结果 */
  function enhance(
    text: string,
    scope: SearchScope,
    live: () => boolean,
    signal: AbortSignal,
    publish: (batch: RecallBatch) => void
  ): void {
    if (!options.ai?.() || scope === 'jav' || !looksNatural(text)) return
    aiTimer = setTimeout(async () => {
      if (!live()) return
      thinking.value = true
      try {
        const parsed = await enhanceConditions(text, scope, signal)
        if (!live()) return
        await searchLibrary(
          { text, scope, filter: parsed, signal },
          batch => {
            if (live() && batch.kind === 'ai') publish(batch)
          },
          [recallAi(aiReason(parsed, scope))]
        )
      } catch {
        // AI 没理解出条件 / 失败 / 停止：只留本地结果
      } finally {
        if (live()) thinking.value = false
      }
    }, AI_DELAY_MS)
  }

  async function run(): Promise<void> {
    stop()
    const text = options.text().trim().slice(0, 500)
    if (!text || isSearchCommand(text) || !options.open()) {
      batches.value = []
      return
    }
    const token = generation
    const current = new AbortController()
    controller = current
    const live = (): boolean => token === generation && !current.signal.aborted
    filter.value = ruleFilter(text)
    busy.value = true
    message.value = searchAvailable()
      ? ''
      : '请先连接媒体库；在线搜索仍可使用。'
    visualNotice.value = ''
    let first = true
    let aiFresh = false
    const scope = options.scope()
    enhance(text, scope, live, current.signal, batch => {
      aiFresh = true
      put(batch)
    })
    try {
      await searchLibrary(
        {
          text,
          scope,
          visualSource: options.visualSource?.() ?? 'all',
          filter: filter.value,
          signal: current.signal,
        },
        batch => {
          if (!live()) return
          if (first) {
            // 换掉上一句的结果；本句 AI 那一路若已先到则保留
            batches.value = batches.value.filter(
              value => value.kind === 'ai' && aiFresh
            )
            first = false
          }
          put(batch)
          if (batch.message) {
            if (batch.kind === 'visual') visualNotice.value = batch.message
            else message.value = batch.message
          }
        }
      )
    } catch (error) {
      if (live()) message.value = errorText(error)
    } finally {
      if (live()) busy.value = false
    }
  }

  watch(
    [options.text, options.scope, options.open],
    () => {
      stop()
      batches.value = []
      message.value = ''
      filter.value = {}
      if (!options.open() || !options.text().trim()) {
        return
      }
      timer = setTimeout(() => void run(), 120)
    },
    { immediate: true, flush: 'sync' }
  )
  if (options.ai)
    watch(options.ai, () => {
      stop()
      if (options.open()) void run()
    })
  if (options.visualSource)
    watch(
      options.visualSource,
      () => {
        stop()
        batches.value = batches.value.filter(batch => batch.kind !== 'visual')
        if (options.open()) void run()
      },
      { flush: 'sync' }
    )
  onScopeDispose(stop)
  return {
    hits,
    actors,
    filter,
    busy,
    thinking,
    message,
    visualNotice,
    run,
    stop,
  }
}
