/** NAS 首页选中的剧集进入网盘页后预填片名，来源就绪时自动搜索。 */
import { type Ref, watch } from 'vue'
import { useRoute } from 'vue-router'

/** 只在 NAS 使用路由查询；完整版本的网盘入口保持原行为。 */
export function useIncomingSearch(
  keyword: Ref<string>,
  configured: Ref<boolean>,
  search: () => void
): void {
  if (import.meta.env.MODE !== 'nas') return
  const route = useRoute()
  watch(
    [() => (route.path === '/netdisk' ? route.query.q : undefined), configured],
    ([query, ready]) => {
      if (typeof query !== 'string' || !query.trim()) return
      keyword.value = query
      if (ready) search()
    },
    { immediate: true }
  )
}
