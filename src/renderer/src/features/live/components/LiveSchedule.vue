<template>
  <section class="live-schedule" aria-label="今日节目单">
    <h3 class="live-schedule-title">今日节目</h3>
    <p v-if="!rows.length" class="live-schedule-empty">{{ emptyText }}</p>
    <ol v-else ref="listEl" class="live-schedule-list">
      <li
        v-for="row in rows"
        :key="row.start"
        class="live-schedule-row"
        :class="`is-${row.state}`"
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
 * 选中频道的今日节目单：已播灰显，正在播出高亮并自动滚到可见处。
 */
import { computed, nextTick, ref, watch } from 'vue'

import { formatClock, scheduleRows } from '../utils/epg-rules'
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

/** 换频道或换档时把正在播出的一行滚进视野 */
watch(
  [() => props.programmes, liveStart],
  async () => {
    await nextTick()
    listEl.value
      ?.querySelector('[data-state="live"]')
      ?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true }
)
</script>

<style scoped>
.live-schedule {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-2);
}

.live-schedule-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.live-schedule-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.live-schedule-list {
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
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.live-schedule-row.is-past {
  color: var(--text-tertiary);
}

.live-schedule-row.is-live {
  background: var(--bg-active);
}

.live-schedule-time {
  flex: none;
  font-family: var(--font-mono);
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
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
</style>
