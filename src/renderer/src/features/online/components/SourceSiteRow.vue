<template>
  <div
    class="site-row"
    :class="{ 'is-enabled': enabled, 'is-fail': status === 'fail' }"
    @click="emit('toggle')"
  >
    <span
      class="site-dot"
      :class="`is-${status || 'unknown'}`"
      :title="statusText"
      :aria-label="statusText"
      role="img"
    />
    <div class="site-text">
      <span class="site-name">{{ name }}</span>
      <span v-if="note" class="site-note">{{ note }}</span>
      <span v-else class="site-api">{{ api }}</span>
    </div>
    <em class="site-badge" :class="`is-${badgeColor}`">{{ badge }}</em>
    <div class="site-actions" @click.stop>
      <UiIconButton
        v-if="checkable"
        icon="refresh"
        size="sm"
        :label="`${checkLabel} ${name}`"
        :loading="checking"
        @click="emit('check')"
      />
      <UiIconButton
        v-if="deletable"
        icon="trash"
        size="sm"
        danger
        :label="`删除数据源 ${name}`"
        @click="emit('delete')"
      />
    </div>
    <UiSwitch
      :model-value="enabled"
      :label="`启用数据源 ${name}`"
      @click.stop
      @update:model-value="emit('toggle')"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 数据源列表的一行：状态点 + 名称（悬停显示 API）+ 类型角标，
 * 右侧是检测 / 删除图标按钮（悬停出现）和启用开关。点整行也能切换启用。
 */
import { computed } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

const props = withDefaults(
  defineProps<{
    name: string
    api: string
    badge: string
    badgeColor?: 'blue' | 'purple' | 'pink' | 'amber'
    enabled: boolean
    /** 'ok' | 'fail' | 'checking' | 'unknown' */
    status?: string
    checking?: boolean
    /** 是否提供「检测」按钮（插件源只在不可用时提供「重试」） */
    checkable?: boolean
    /** 检测按钮的读屏文字前缀 */
    checkLabel?: string
    /** 名称旁的一行说明（如插件源不可用的原因） */
    note?: string
    deletable?: boolean
  }>(),
  {
    badgeColor: 'blue',
    status: 'unknown',
    checkable: true,
    checkLabel: '检测数据源',
    note: '',
  }
)
const emit = defineEmits<{ toggle: []; check: []; delete: [] }>()

const statusText = computed(() => {
  if (props.status === 'ok') return '可用'
  if (props.status === 'fail') return '不可用'
  if (props.status === 'checking') return '检测中'
  return '未检测'
})
</script>

<style scoped>
.site-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  transition: background-color var(--duration-fast) ease;
}
.site-row + .site-row::before {
  position: absolute;
  top: 0;
  right: 0;
  left: calc(var(--space-4) + var(--space-2) + var(--space-3));
  height: 1px;
  background: var(--separator);
  content: '';
}
.site-row:hover {
  background: var(--bg-glass-hover);
}
.site-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-quaternary);
}
.site-dot.is-ok {
  background: var(--success);
}
.site-dot.is-fail {
  background: var(--danger);
}
.site-dot.is-checking {
  background: var(--warning);
  animation: site-pulse var(--duration-pulse) infinite;
}
.site-text {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.site-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-row.is-fail .site-name {
  color: var(--danger);
}
.site-api {
  display: none;
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-row:hover .site-api {
  display: block;
}
.site-note {
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-badge {
  flex-shrink: 0;
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  background: var(--bg-active-soft);
  font-size: var(--text-2xs);
  font-style: normal;
  font-weight: var(--font-weight-medium);
}
.site-badge.is-purple {
  color: color-mix(in srgb, var(--tint-purple) 80%, var(--text-primary));
  background: color-mix(in srgb, var(--tint-purple) 14%, transparent);
}
.site-badge.is-pink {
  color: color-mix(in srgb, var(--favorite) 80%, var(--text-primary));
  background: color-mix(in srgb, var(--favorite) 14%, transparent);
}
.site-badge.is-amber {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}
.site-actions {
  display: flex;
  gap: var(--space-0_5);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.site-row:hover .site-actions,
.site-row:focus-within .site-actions,
.site-actions:has([aria-busy='true']) {
  opacity: 1;
}
@keyframes site-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (hover: none) {
  .site-actions {
    opacity: 1;
  }
}
</style>
