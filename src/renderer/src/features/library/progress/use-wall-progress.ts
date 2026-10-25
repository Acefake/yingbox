/**
 * 海报墙的观看标记取数：可见区间里的顶层条目向片库要观看概况（progress.summary），按 id 缓存；
 * 区间变了只补没要过的，停下 200 毫秒再要（快速滚动时不发）；进度写进片库或同步拉下新进度后整体重要。
 * 标记规则在 watch-marks.ts。
 */
import { type Ref, onBeforeUnmount, shallowRef, watch } from 'vue'

import type { ProgressSummary } from '../../../../../shared/library/ipc'

import { libraryBridge } from '../api/bridge'
import { onProgressSaved } from './progress-cache'
import { type WatchMark, posterMark } from './watch-marks'

const DEBOUNCE_MS = 200

/**
 * @param ids 可见区间里已加载的顶层条目 id
 * @returns 取某个条目海报卡标记的函数（响应式）
 */
export function useWallProgress(
  ids: () => readonly number[]
): (itemId: number) => WatchMark | null {
  const summaries: Ref<Map<number, ProgressSummary>> = shallowRef(new Map())
  /** 要过的 id（没看过的也记，免得重复要） */
  let asked = new Set<number>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchMissing = async (): Promise<void> => {
    const bridge = libraryBridge()
    const missing = ids().filter(id => !asked.has(id))
    if (!bridge || !missing.length) return
    for (const id of missing) asked.add(id)
    try {
      const list = await bridge.progress.summary(missing)
      const next = new Map(summaries.value)
      for (const id of missing) next.delete(id)
      for (const s of list) next.set(s.itemId, s)
      summaries.value = next
    } catch {
      for (const id of missing) asked.delete(id)
    }
  }

  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void fetchMissing(), DEBOUNCE_MS)
  }

  watch(() => ids().join(','), schedule, { immediate: true })
  const off = onProgressSaved(() => {
    asked = new Set()
    schedule()
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    off()
  })

  return itemId => posterMark(summaries.value.get(itemId))
}
