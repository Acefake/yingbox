import { type ComputedRef, computed } from 'vue'
import type { Router } from 'vue-router'
import type { OnlineDetailItem } from '../types'

let entry = 0

/** 在线详情随浏览器历史切换；条目保存在当前历史项，不写入 URL。 */
export function useOnlineDetailRoute(router: Router): {
  item: ComputedRef<OnlineDetailItem | null>
  open(item: OnlineDetailItem): Promise<unknown>
  close(): void
} {
  const item = computed<OnlineDetailItem | null>(() => {
    const route = router.currentRoute.value
    if (route.path !== '/' || !route.query.detail) return null
    const raw = router.options.history.state.onlineDetail
    if (typeof raw !== 'string') return null
    try {
      const value: unknown = JSON.parse(raw)
      return value &&
        typeof value === 'object' &&
        'vod_name' in value &&
        typeof value.vod_name === 'string'
        ? { ...value, vod_name: value.vod_name }
        : null
    } catch {
      return null
    }
  })
  return {
    item,
    open(next) {
      const route = router.currentRoute.value
      const location = {
        path: '/',
        query: { ...route.query, detail: `${Date.now()}-${++entry}` },
        state: { onlineDetail: JSON.stringify(next), onlineDetailEntry: true },
      }
      return item.value ? router.replace(location) : router.push(location)
    },
    close() {
      if (router.options.history.state.onlineDetailEntry) router.back()
      else {
        const { detail: _detail, ...query } = router.currentRoute.value.query
        void router.replace({ path: '/', query })
      }
    },
  }
}
