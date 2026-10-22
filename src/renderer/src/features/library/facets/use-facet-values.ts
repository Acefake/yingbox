/**
 * 筛选面板的取值加载：类型计数 + 当前页签分面的取值（可搜索），范围跟海报墙一致。
 *
 * 搜索 150ms 防抖；请求带序号，慢的旧请求回来不覆盖新结果。
 * 面板打开时才加载，关上不发请求；范围（来源 / 媒体库）变了自动重载。
 */
import { useDebounceFn } from '@vueuse/core'
import { type Ref, ref, watch } from 'vue'
import type {
  FacetField,
  FacetListRequest,
  FacetValue,
  JavKind,
} from '../../../../../shared/library/ipc'
import { libraryBridge } from '../api/bridge'
import type { TextFacet } from './facet-rules'

/** 每个分面最多显示的取值数。 */
const LIMIT = 80

export function useFacetValues(options: {
  open: Ref<boolean>
  scope: () => Omit<FacetListRequest, 'field'> | undefined
}): {
  tab: Ref<TextFacet>
  search: Ref<string>
  values: Ref<FacetValue[]>
  kindCounts: Ref<Partial<Record<JavKind, number>>>
  loading: Ref<boolean>
} {
  const tab = ref<TextFacet>('tag')
  const search = ref('')
  const values = ref<FacetValue[]>([])
  const kindCounts = ref<Partial<Record<JavKind, number>>>({})
  const loading = ref(false)
  let seq = 0

  async function list(
    field: FacetField,
    text = ''
  ): Promise<FacetValue[] | null> {
    const scope = options.scope()
    const api = libraryBridge()?.facets
    if (!scope || !api) return null
    return api.list({
      ...scope,
      field,
      limit: LIMIT,
      ...(text ? { search: text } : {}),
    })
  }

  async function loadValues(): Promise<void> {
    const id = ++seq
    loading.value = true
    try {
      const found = await list(tab.value, search.value.trim())
      if (id === seq) values.value = found ?? []
    } catch {
      if (id === seq) values.value = []
    } finally {
      if (id === seq) loading.value = false
    }
  }

  async function loadKinds(): Promise<void> {
    try {
      const found = (await list('kind')) ?? []
      kindCounts.value = Object.fromEntries(
        found.map(v => [v.value, v.count])
      ) as Partial<Record<JavKind, number>>
    } catch {
      kindCounts.value = {}
    }
  }

  const searchLater = useDebounceFn(() => void loadValues(), 150)

  watch(
    () => [options.open.value, JSON.stringify(options.scope() ?? null)],
    () => {
      if (!options.open.value) return
      void loadKinds()
      void loadValues()
    },
    { immediate: true }
  )
  watch(tab, () => {
    search.value = ''
    if (options.open.value) void loadValues()
  })
  watch(search, () => {
    if (options.open.value) void searchLater()
  })

  return { tab, search, values, kindCounts, loading }
}
