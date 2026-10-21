<template>
  <div class="review">
    <aside class="review-list-pane">
      <div class="review-list-head">
        <UiSegmented
          v-model="scope"
          size="sm"
          label="待确认范围"
          :options="SCOPE_OPTIONS"
        />
        <span class="review-count">{{ total }} 项</span>
      </div>
      <div
        ref="scroller"
        class="review-list custom-scrollbar"
        role="listbox"
        aria-label="待确认条目"
        tabindex="0"
        @scroll.passive="onScroll"
        @keydown="onKeydown"
      >
        <div
          class="review-list-inner"
          :style="{ height: `${total * ROW_HEIGHT}px` }"
        >
          <UiPressable
            v-for="row in rows"
            :key="row.key"
            block
            class="review-row"
            :class="{ 'is-active': row.item && row.item.id === selectedId }"
            :style="{ transform: `translateY(${row.index * ROW_HEIGHT}px)` }"
            role="option"
            :aria-selected="row.item?.id === selectedId"
            tabindex="-1"
            @click="row.item && select(row.index, row.item.id)"
          >
            <template v-if="row.item">
              <span class="review-row-title">{{ row.item.title }}</span>
              <span class="review-row-meta">
                <span v-if="row.item.year">{{ row.item.year }}</span>
                <span
                  class="review-row-state"
                  :class="`is-${row.item.matchState}`"
                  >{{ MATCH_STATE_LABEL[row.item.matchState] }}</span
                >
              </span>
            </template>
          </UiPressable>
        </div>
        <div v-if="ready && total === 0" class="review-empty">
          <UiIcon name="check" size="lg" />
          <p>全部确认完了</p>
        </div>
      </div>
    </aside>
    <section class="review-detail custom-scrollbar">
      <MatchPane :item-id="selectedId" @resolved="advance" />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 待确认队列：左侧是待确认 / 未匹配条目（虚拟列表，按需分页），右侧是匹配对照面板。
 * 确认一条后自动跳到下一条；↑ / ↓ 切换条目，1 / 2 / 3 采用候选。
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'

import type {
  LibraryItemSummary,
  MatchState,
} from '../../../../../shared/library/ipc'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import { MATCH_STATE_LABEL } from '../shared/format'
import type { LibrarySection } from '../state/library-section'
import { reviewQuery } from '../state/query-state'
import { usePagedQuery } from '../state/use-paged-query'
import MatchPane from './MatchPane.vue'

const props = defineProps<{
  section: LibrarySection
  /** 本分区媒体库的 id，用来过滤 items-changed 事件。 */
  libraryIds: number[]
}>()

type Scope = 'review' | 'unmatched' | 'both'
const SCOPE_OPTIONS: SegmentedOption<Scope>[] = [
  { value: 'both', label: '全部' },
  { value: 'review', label: '待确认' },
  { value: 'unmatched', label: '未匹配' },
]
const SCOPE_STATES: Record<Scope, MatchState[]> = {
  both: ['review', 'unmatched'],
  review: ['review'],
  unmatched: ['unmatched'],
}

const ROW_HEIGHT = 56
const OVERSCAN = 6

const scope = ref<Scope>('both')
const { list, version, total, ready, setVisible } = usePagedQuery(
  () => reviewQuery(props.section, SCOPE_STATES[scope.value]),
  event => props.libraryIds.includes(event.libraryId),
  100
)

const scroller = ref<HTMLElement | null>(null)
const range = shallowRef({ start: 0, end: 30 })
const selectedId = ref<number | null>(null)
const selectedIndex = ref(0)
let frame = 0

function measure(): void {
  const el = scroller.value
  if (!el) return
  const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    total.value,
    Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT) + OVERSCAN
  )
  if (start !== range.value.start || end !== range.value.end) {
    range.value = { start, end }
    setVisible(start, end)
  }
}

function onScroll(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

onMounted(measure)
watch(total, measure)

const rows = computed(() => {
  void version.value
  const out: Array<{
    key: number | string
    index: number
    item: LibraryItemSummary | undefined
  }> = []
  for (let index = range.value.start; index < range.value.end; index++) {
    const item = list.at(index)
    out.push({ key: item ? item.id : `p${index}`, index, item })
  }
  return out
})

// 列表首次到达或选中项被移出队列时，选中当前位置上的条目
watch(version, () => {
  if (selectedId.value !== null && list.indexOfId(selectedId.value) >= 0) {
    return
  }
  const item =
    list.at(Math.min(selectedIndex.value, Math.max(0, total.value - 1))) ?? null
  if (item) selectedId.value = item.id
  else if (ready.value && total.value === 0) selectedId.value = null
})

watch(scope, () => {
  selectedId.value = null
  selectedIndex.value = 0
  scroller.value?.scrollTo({ top: 0 })
})

function select(index: number, id: number): void {
  selectedIndex.value = index
  selectedId.value = id
  const el = scroller.value
  if (!el) return
  const top = index * ROW_HEIGHT
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
    el.scrollTop = top + ROW_HEIGHT - el.clientHeight
  }
}

/** 已确认：先跳到下一条（没有就上一条），队列随后由事件刷新。 */
function advance(resolvedId: number): void {
  const index = list.indexOfId(resolvedId)
  if (index < 0) return
  // 已确认的条目随后会被移出队列，下一条会落到当前位置
  const after = list.at(index + 1)
  if (after) {
    selectedIndex.value = index
    selectedId.value = after.id
    return
  }
  const before = index > 0 ? list.at(index - 1) : undefined
  if (before) select(index - 1, before.id)
  else selectedId.value = null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const delta = event.key === 'ArrowDown' ? 1 : -1
  const index = Math.min(
    total.value - 1,
    Math.max(0, selectedIndex.value + delta)
  )
  const item = list.at(index)
  if (item) select(index, item.id)
}
</script>

<style scoped>
.review {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.review-list-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: var(--content-padding-x);
}
.review-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-3) var(--space-3) 0;
}
.review-count {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.review-list {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  outline: none;
}
.review-list-inner {
  position: relative;
}
.review-row {
  position: absolute;
  top: 0;
  right: var(--space-3);
  left: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-0_5);
  height: 52px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  text-align: left;
}
.review-row:hover {
  background: var(--bg-glass);
}
.review-row.is-active {
  background: var(--bg-active);
}
.review-row-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-row-meta {
  display: flex;
  gap: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.review-row-state.is-review {
  color: var(--warning);
}
.review-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-11) 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.review-detail {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--content-padding-x) var(--space-10) var(--space-7);
  border-left: 1px solid var(--separator);
}
</style>
