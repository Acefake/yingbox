/**
 * 由路由 query 驱动的覆盖层（条目详情 ?item=、演员详情 ?actor=）：打开是 push，浏览器后退即关闭；
 * 直接打开链接（没有上一页）时关闭改为去掉这个参数。
 */
import { type ComputedRef, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { parseDetailId } from './page-rules'

/** 一个覆盖层的路由状态与开关。 */
export interface OverlayRoute {
  /** 当前打开的 id；没打开为 null。 */
  id: ComputedRef<number | null>
  open: (value: number, drop?: readonly string[]) => void
  close: () => void
}

/** 一个覆盖层（key 是路由 query 的参数名）。 */
export function useOverlayRoute(key: 'item' | 'actor'): OverlayRoute {
  const route = useRoute()
  const router = useRouter()
  const id = computed(() => parseDetailId(route.query[key]))

  /** 打开；drop 里的参数一并去掉（从条目详情点演员时关掉条目详情，后退可回来）。 */
  function open(value: number, drop: readonly string[] = []): void {
    const query = { ...route.query, [key]: String(value) }
    for (const k of drop) delete query[k]
    void router.push({ query })
  }

  function close(): void {
    if (window.history.state?.back) router.back()
    else {
      const { [key]: _removed, ...rest } = route.query
      void router.replace({ query: rest })
    }
  }

  return { id, open, close }
}
