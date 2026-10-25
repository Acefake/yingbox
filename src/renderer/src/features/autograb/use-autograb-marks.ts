/**
 * 日历卡片上的追更小标记：挂载期间共用追更总览（见 autograb-store.ts），按「剧 id:季:集」取标记。
 * 网页端没有追更，始终为空。
 */
import { type ComputedRef, computed, onBeforeUnmount, onMounted } from 'vue'

import { autograbAvailable } from './api'
import { type AutograbMark, marksOf } from './autograb-rules'
import { autograbStore } from './autograb-store'

/** 「剧 id:季:集」→ 小标记 */
export function useAutograbMarks(): ComputedRef<Map<string, AutograbMark>> {
  if (!autograbAvailable) return computed(() => new Map())
  let release: (() => void) | null = null
  onMounted(() => (release = autograbStore.acquire()))
  onBeforeUnmount(() => release?.())
  return computed(() => marksOf(autograbStore.overview.value))
}
