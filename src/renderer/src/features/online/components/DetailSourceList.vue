<template>
  <div class="dsl-head">
    <span class="yb-label">源</span>
    <span class="dsl-status">{{ statusText }}</span>
    <UiButton
      size="sm"
      variant="plain"
      icon="refresh"
      label="重新测速"
      :loading="probing"
      @click="emit('reprobe')"
    />
  </div>
  <div class="dsl-list">
    <UiListRow
      v-for="(row, index) in rows"
      :key="row.siteName"
      class="dsl-row"
      :class="{ 'is-failed': row.status === 'fail' }"
      :selected="activeSite === index"
      :aria-pressed="activeSite === index"
      @click="emit('switch-site', index)"
    >
      <template #leading>
        <span class="dsl-dot" :class="`is-${row.status}`" />
      </template>
      {{ row.siteName }}
      <template #description>{{ row.detail }}</template>
      <template v-if="row.fastest" #trailing>
        <span class="dsl-badge">最快</span>
      </template>
    </UiListRow>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情页的源列表：每个源一行，状态点 + 名称 + 分辨率 · 延迟 · 速度，最快的标「最快」，
 * 测速失败的灰掉（顺序已由 useDetailSources 排好，失败的在最后）。
 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import {
  type SourceProbe,
  fastestSite,
  formatLatency,
  formatSpeed,
  resolutionLabel,
} from '../utils/auto-source'
import type { SiteGroup } from '../utils/detail-sources'

const props = defineProps<{
  siteGroups: SiteGroup[]
  activeSite: number
  probes: Record<string, SourceProbe>
  probing: boolean
}>()
const emit = defineEmits<{
  (e: 'switch-site', index: number): void
  (e: 'reprobe'): void
}>()

const statusText = computed(() =>
  props.probing ? '测速中…' : '测速完成 · 按速度排序'
)

const rows = computed(() => {
  const fastest = fastestSite(props.siteGroups, props.probes)
  return props.siteGroups.map(sg => {
    const probe = props.probes[sg.siteName]
    const status = probe?.status ?? 'pending'
    let detail = '测速中…'
    if (status === 'ok')
      detail = [
        resolutionLabel(probe?.height),
        formatLatency(probe?.latencyMs),
        formatSpeed(probe?.speedBps),
      ]
        .filter(Boolean)
        .join(' · ')
    else if (status === 'fail') detail = '超时或无法播放'
    return {
      siteName: sg.siteName,
      status,
      detail,
      fastest: !!fastest && sg.siteName === fastest,
    }
  })
})
</script>

<style scoped>
.dsl-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  margin-bottom: var(--space-1);
}

.dsl-status {
  flex: 1;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.dsl-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-1);
  max-height: 264px;
  overflow-y: auto;
  margin-bottom: var(--space-3);
}

.dsl-row.is-failed {
  color: var(--text-quaternary);
}

.dsl-row.is-failed :deep(.ui-list-row-description) {
  color: var(--text-quaternary);
}

.dsl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-quaternary);
}

.dsl-dot.is-ok {
  background: var(--success);
}

.dsl-dot.is-pending {
  background: var(--warning);
  animation: dsl-pulse var(--duration-spin) ease-in-out infinite;
}

.dsl-badge {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  color: var(--accent);
  background: var(--accent-soft);
}

@keyframes dsl-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsl-dot.is-pending {
    animation: none;
  }
}
</style>
