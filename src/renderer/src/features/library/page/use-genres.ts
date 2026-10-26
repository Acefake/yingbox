/**
 * 类型胶囊的数据：本分区（电影 / 剧集）各类型及其片数，经片库查询 facets.list（field = tag）取得，
 * 桌面端引擎与片库服务（网页 / NAS）同一个方法。
 *
 * 范围（顶层类型 / 来源 / 媒体库）变了立即重载；片库有增删改时合并 1.5 秒内的事件再重载一次。
 * 请求带序号，慢的旧请求回来不覆盖新结果；没有范围（番号页）时为空列表。
 */
import { type Ref, onScopeDispose, ref, watch } from 'vue'

import type {
  FacetListRequest,
  FacetValue,
} from '../../../../../shared/library/ipc'
import { libraryBridge } from '../api/bridge'
import { onLibraryEvent } from '../state/library-events'

/** 最多取多少个类型（「全部类型」浮层里全部列出）。 */
const LIMIT = 200
/** 片库事件合并重载的间隔。 */
const RELOAD_MS = 1500

export function useGenres(
  scope: () => FacetListRequest | undefined
): Ref<FacetValue[]> {
  const genres = ref<FacetValue[]>([])
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load(): Promise<void> {
    const id = ++seq
    const request = scope()
    const api = libraryBridge()?.facets
    if (!request || !api) {
      genres.value = []
      return
    }
    try {
      const found = await api.list({ ...request, limit: LIMIT })
      if (id === seq) genres.value = found
    } catch {
      if (id === seq) genres.value = []
    }
  }

  watch(
    () => JSON.stringify(scope() ?? null),
    () => void load(),
    {
      immediate: true,
    }
  )

  onLibraryEvent(event => {
    if (event.type !== 'items-changed' || !scope()) return
    const libraryId = scope()?.libraryId
    if (libraryId !== undefined && event.libraryId !== libraryId) return
    timer ??= setTimeout(() => {
      timer = undefined
      void load()
    }, RELOAD_MS)
  })

  onScopeDispose(() => clearTimeout(timer))

  return genres
}
