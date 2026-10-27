<template>
  <section class="live-schedule" aria-label="今日节目单">
    <header class="live-schedule-head">
      <h3 class="live-schedule-title">今日节目单</h3>
      <span class="live-schedule-day">{{ formatDayLabel(now) }}</span>
    </header>
    <p v-if="!rows.length" class="live-schedule-empty">{{ emptyText }}</p>
    <ol v-else ref="listEl" class="live-schedule-list">
      <li
        v-for="row in rows"
        :key="row.start"
        class="live-schedule-row"
        :class="[`is-${row.state}`, { 'is-next': row.start === nextStart }]"
        :data-state="row.state"
      >
        <span class="live-schedule-time">{{ formatClock(row.start) }}</span>
        <span class="live-schedule-name">{{ row.title || '未知节目' }}</span>
        <span v-if="row.state === 'live'" class="live-schedule-badge"
          >正在播出</span
        >
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
/**
 * 选中频道的今日节目单（实色卡片，标题旁是今天的日期）：已播灰显，正在播出高亮并红字标注，下一档稍亮；
 * 换频道或换档时只在列表内部把正在播出的一档滚到前两行之后，不带动整页滚动。
 */
import { computed, nextTick, ref, watch } from 'vue'

import { formatClock, formatDayLabel, scheduleRows } from '../utils/epg-rules'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

const props = defineProps<{
  programmes: EpgProgramme[] | undefined
  now: number
  emptyText: string
}>()

const listEl = ref<HTMLOListElement | null>(null)
const rows = computed(() => scheduleRows(props.programmes, props.now))
const liveStart = computed(
  () => rows.value.find(r => r.state === 'live')?.start ?? 0
)
/** 下一档：正在播出之后的第一档（没有正在播出时为第一档未播） */
const nextStart = computed(
  () => rows.value.find(r => r.state === 'upcoming')?.start ?? -1
)

/** 正在播出那一行上方留出的行数 */
const LEAD_ROWS = 2

/** 换频道或换档时把正在播出的一行滚到列表上部（只滚列表自己，scrollIntoView 会带动整页） */
watch(
  [() => props.programmes, liveStart],
  async () => {
    await nextTick()
    const list = listEl.value
    const row = list?.querySelector<HTMLElement>('[data-state="live"]')
    if (!list || !row) return
    list.scrollTop = Math.max(0, row.offsetTop - row.offsetHeight * LEAD_ROWS)
  },
  { immediate: true }
)
</script>

<style scoped>
.live-schedule {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-1_5);
  padding: var(--space-3) var(--space-1_5) var(--space-1_5);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

.live-schedule-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.live-schedule-title {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.live-schedule-day {
  font-variant-numeric: tabular-nums;
}

.live-schedule-empty {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.live-schedule-list {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.live-schedule-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 40px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.live-schedule-row.is-past {
  color: var(--text-tertiary);
}

.live-schedule-row.is-next {
  color: var(--text-primary);
}

.live-schedule-row.is-live {
  background: var(--bg-active);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}

.live-schedule-time {
  flex: none;
  width: 44px;
  font-variant-numeric: tabular-nums;
}

.live-schedule-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-schedule-badge {
  flex: none;
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}
</style>
