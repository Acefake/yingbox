/**
 * 媒体库页面的视图切换：资料库 / 演员（只在番号页）/ 待确认（带数量角标）。
 *
 * 待确认数量只取 1 条拿 total，按本分区的库过滤事件，不在别的分区有变化时重查。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'

import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'

import type { LibrarySection } from '../state/library-section'
import { reviewQuery } from '../state/query-state'
import { usePagedQuery } from '../state/use-paged-query'
import type { LibraryView } from './LibraryToolbar.vue'
import { viewOptionsFor } from './page-rules'

/** 视图切换的状态。 */
export interface LibraryViews {
  view: Ref<LibraryView>
  viewOptions: ComputedRef<SegmentedOption<LibraryView>[]>
}

/**
 * @param section 当前分区
 * @param libraryIds 本分区的库 id（过滤引擎事件）
 */
export function useLibraryViews(
  section: LibrarySection,
  libraryIds: ComputedRef<number[]>
): LibraryViews {
  const reviewCount = usePagedQuery(
    () => ({ ...reviewQuery(section), limit: 1 }),
    event => libraryIds.value.includes(event.libraryId),
    1
  )
  const view = ref<LibraryView>('wall')
  const viewOptions = computed(() =>
    viewOptionsFor(section, reviewCount.total.value)
  )
  return { view, viewOptions }
}
