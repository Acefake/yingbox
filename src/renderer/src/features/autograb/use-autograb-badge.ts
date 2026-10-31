/**
 * 侧栏「自动追更」角标：要用户处理的集数（有候选待确认、空间不足、找不到）。
 * 第一次调用时延后几秒再取总览，不和启动时的其它请求抢；订阅整个应用生命周期不退订。网页端没有追更，始终为 0。
 */
import { type ComputedRef, computed } from 'vue'

import { autograbAvailable } from './api'
import { pendingBadge } from './autograb-rules'
import { autograbStore } from './autograb-store'

let started = false

/** 待处理集数（侧栏角标） */
export function useAutograbBadge(): ComputedRef<number> {
  if (autograbAvailable && !started && typeof window !== 'undefined') {
    started = true
    setTimeout(() => autograbStore.acquire(), 3000)
  }
  return computed(() => pendingBadge(autograbStore.overview.value))
}
