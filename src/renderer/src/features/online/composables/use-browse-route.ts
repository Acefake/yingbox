/**
 * 在线页里浏览页的路由：?browse= 决定显示什么（utils/browse-target.ts），浏览器后退回到首页。
 * 切电影 / 剧集只替换路由，不多压一条历史；返回时有上一条历史就后退，否则回首页。
 */
import { type ComputedRef, type Ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { DoubanKind } from '../../../../../shared/douban/query'
import {
  type BrowseTarget,
  routeQueryOf,
  targetFromRoute,
} from '../utils/browse-target'

/** 浏览页路由的状态与操作 */
export interface BrowseRoute {
  /** 当前浏览目标；不在浏览页时为 null */
  target: ComputedRef<BrowseTarget | null>
  open(target: BrowseTarget): void
  setKind(kind: DoubanKind): void
  close(): void
}

/** @param onHome 在线页当前是否在首页标签 */
export function useBrowseRoute(onHome: Ref<boolean>): BrowseRoute {
  const route = useRoute()
  const router = useRouter()
  const target = computed(() =>
    onHome.value ? targetFromRoute(route.query) : null
  )
  return {
    target,
    open: next => void router.push({ path: '/', query: routeQueryOf(next) }),
    setKind(kind) {
      const current = target.value
      if (current && current.type !== 'list')
        void router.replace({
          path: '/',
          query: routeQueryOf({ ...current, kind }),
        })
    },
    close() {
      if (window.history.state?.back) router.back()
      else void router.replace({ path: '/' })
    },
  }
}
