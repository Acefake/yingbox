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
      v-for="row in rows"
      :key="row.siteName"
      class="dsl-row"
      :class="{ 'is-failed': row.status === 'fail' }"
      :selected="activeSite === row.index"
      :aria-pressed="activeSite === row.index"
      @click="emit('switch-site', row.index)"
    >
      <template #leading>
        <span class="dsl-dot" :class="`is-${row.status}`" />
      </template>
      {{ row.siteName }}
      <template #description>
        <span class="dsl-detail">
          <UiSpecBadge
            v-if="row.resolution"
            variant="solid"
            :text="row.resolution"
          />
          {{ row.detail }}
        </span>
      </template>
      <template v-if="row.fastest" #trailing>
        <span class="dsl-badge">最快</span>
      </template>
    </UiListRow>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情页的源列表：每个源一行，状态点 + 名称 + 分辨率规格标签 + 延迟 · 速度，最快的标「最快」，
 * 测速失败的灰掉（顺序已由 useDetailSources 排好，失败的在最后）。
 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import {
  type SourceProbe,
  fastestSite,
  formatLatency,
  formatSpeed,
  resolutionLabel,
} from '../../../../../shared/online/auto-source'
import type { SiteGroup } from '../../../../../shared/online/sources'

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

const rows = computed(() => {
  const fastest = fastestSite(props.siteGroups, props.probes)
  return props.siteGroups.flatMap((sg, index) => {
    const probe = props.probes[sg.siteName]
    const status = probe?.status ?? 'pending'
    if (status === 'fail' && index !== props.activeSite) return []
    let detail = '测速中…'
    if (status === 'ok')
      detail = [formatLatency(probe?.latencyMs), formatSpeed(probe?.speedBps)]
        .filter(Boolean)
        .join(' · ')
    else if (status === 'fail') detail = '超时或无法播放'
    return {
      index,
      siteName: sg.siteName,
      status,
      resolution: status === 'ok' ? resolutionLabel(probe?.height) : '',
      detail,
      fastest: !!fastest && sg.siteName === fastest,
    }
  })
})

const hiddenCount = computed(() => props.siteGroups.length - rows.value.length)

const statusText = computed(() => {
  if (props.probing) return '测速中…'
  if (rows.value.length && rows.value.every(row => row.status === 'fail'))
    return '这一类源测速都失败了，可换另一类源，或点集数手动试试'
  const base = '测速完成 · 按速度排序'
  return hiddenCount.value
    ? `${base} · 已隐藏 ${hiddenCount.value} 个不可用源`
    : base
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
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  align-items: stretch;
  gap: var(--space-1);
  max-height: 264px;
  overflow-y: auto;
  margin-bottom: var(--space-3);
}

.dsl-detail {
  display: inline-flex;
  white-space: nowrap;
  align-items: center;
  gap: var(--space-1);
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
