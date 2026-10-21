/**
 * 演员列表的数据：按搜索 / 排序分页拉全（每页 1000，演员数通常几百到几千），换条件时换代，
 * 迟到的旧响应丢弃；引擎推 actors-changed / items-changed 时防抖重拉。
 *
 * 列表是普通数组放在 shallowRef 里（不做深层代理），交给 UiVirtualGrid 只渲染视口附近的卡片。
 */
import { useDebounceFn } from '@vueuse/core'
import { type Ref, type ShallowRef, ref, shallowRef, watch } from 'vue'

import type {
  ActorSortField,
  ActorSummary,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { onLibraryEvent } from '../state/library-events'

/** 每页条数（引擎上限）。 */
const PAGE = 1000
/** 引擎事件后的重拉防抖：识别时事件密集，攒一下再拉。 */
const RELOAD_DEBOUNCE_MS = 1000

/** useActorList 的返回值。 */
export interface ActorList {
  actors: ShallowRef<ActorSummary[]>
  total: Ref<number>
  /** 至少完成过一次加载。 */
  loaded: Ref<boolean>
  error: Ref<string | null>
  /** 搜索框文字（200ms 防抖后生效）。 */
  search: Ref<string>
  sort: Ref<ActorSortField>
  reload: () => Promise<void>
}

/** 演员列表。 */
export function useActorList(): ActorList {
  const bridge = libraryBridge()
  const actors = shallowRef<ActorSummary[]>([])
  const total = ref(0)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const sort = ref<ActorSortField>('works')
  const term = ref('')
  let generation = 0

  async function load(): Promise<void> {
    if (!bridge) return
    const gen = ++generation
    try {
      const out: ActorSummary[] = []
      let count = 0
      do {
        const page = await bridge.actors.list({
          search: term.value || undefined,
          sort: sort.value,
          offset: out.length,
          limit: PAGE,
        })
        if (gen !== generation) return
        count = page.total
        out.push(...page.items)
        if (!page.items.length) break
      } while (out.length < count)
      actors.value = out
      total.value = count
      error.value = null
    } catch (e) {
      if (gen === generation) error.value = errorText(e)
    } finally {
      if (gen === generation) loaded.value = true
    }
  }

  const applySearch = useDebounceFn((text: string) => {
    term.value = text.trim()
  }, 200)
  watch(search, text => void applySearch(text))
  watch([term, sort], () => void load(), { immediate: true })

  const reloadSoon = useDebounceFn(() => void load(), RELOAD_DEBOUNCE_MS)
  onLibraryEvent(event => {
    if (event.type === 'actors-changed' || event.type === 'items-changed')
      void reloadSoon()
  })

  return { actors, total, loaded, error, search, sort, reload: load }
}
