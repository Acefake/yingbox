/** 搜索会话：输入即取消旧查询，先本地后增强；所有异步更新绑定同一世代。 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { ActorSummary } from '../../../../../shared/library/ipc'
import { errorText } from '../api/bridge'
import type { NlFilter } from '../nl-search/nl-filter'
import { enhanceConditions } from './ai-conditions'
import { fuseSearch, routeSearch, ruleFilter } from './search-rules'
import { searchAccessKey } from './search-access'
import { searchAvailable, searchLibrary } from './search-service'
import type {
  RecallBatch,
  SearchHit,
  SearchRequest,
  SearchScope,
} from './types'

export interface UnifiedSearchState {
  hits: ComputedRef<SearchHit[]>
  actors: ComputedRef<ActorSummary[]>
  filter: Ref<NlFilter>
  busy: Ref<boolean>
  thinking: Ref<boolean>
  message: Ref<string>
  visualNotice: Ref<string>
  run(enhance?: boolean, override?: NlFilter): Promise<void>
  stop(): void
}

export function useUnifiedSearch(options: {
  text: () => string
  scope: () => SearchScope
  open: () => boolean
  ai: () => boolean
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

  const hits = computed(() =>
    fuseSearch(batches.value, routeSearch(options.text()))
  )
  const actors = computed(
    () => batches.value.find(batch => batch.kind === 'people')?.actors ?? []
  )

  function stop(): void {
    generation++
    clearTimeout(timer)
    controller?.abort()
    controller = null
    busy.value = false
    thinking.value = false
  }

  async function run(enhance = false, override?: NlFilter): Promise<void> {
    stop()
    const text = options.text().trim().slice(0, 500)
    if (!text || !options.open()) {
      batches.value = []
      return
    }
    const token = generation
    const current = new AbortController()
    controller = current
    const live = (): boolean => token === generation && !current.signal.aborted
    const request: SearchRequest = {
      text,
      scope: options.scope(),
      filter: override ?? ruleFilter(text),
      signal: current.signal,
    }
    filter.value = request.filter ?? {}
    busy.value = true
    message.value = searchAvailable()
      ? ''
      : '请先连接媒体库；在线搜索仍可使用。'
    visualNotice.value = ''
    let recallRevision = 0

    async function recall(next: SearchRequest): Promise<void> {
      const revision = ++recallRevision
      let first = true
      await searchLibrary(next, batch => {
        if (!live() || revision !== recallRevision) return
        if (first) {
          batches.value = []
          first = false
        }
        batches.value = [
          ...batches.value.filter(value => value.kind !== batch.kind),
          batch,
        ]
        if (batch.message) {
          if (batch.kind === 'visual') visualNotice.value = batch.message
          else message.value = batch.message
        }
      })
      if (live() && revision === recallRevision) {
        if (first) batches.value = []
        busy.value = false
      }
    }

    // 本地召回与条件解析同时启动，互不等待。
    const local = recall(request)
    if (enhance && options.ai() && request.scope !== 'jav') {
      thinking.value = true
      try {
        const parsed = await enhanceConditions(
          text,
          request.scope,
          current.signal
        )
        if (!live()) return
        filter.value = parsed
        busy.value = true
        await recall({ ...request, filter: parsed })
      } catch (error) {
        if (live()) message.value = errorText(error)
      } finally {
        if (live()) {
          thinking.value = false
          busy.value = false
        }
      }
    } else await local
  }

  watch(
    [
      options.text,
      options.scope,
      options.open,
      () => searchAccessKey(options.scope()),
    ],
    (next, previous) => {
      stop()
      if (previous && next[3] !== previous[3]) batches.value = []
      filter.value = {}
      message.value = ''
      if (!options.open() || !options.text().trim()) {
        batches.value = []
        return
      }
      timer = setTimeout(() => void run(), 120)
    },
    { immediate: true, flush: 'sync' }
  )
  watch(options.ai, () => {
    stop()
    if (options.open()) void run()
  })
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
