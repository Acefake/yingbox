<template>
  <div ref="root" class="filter-pill">
    <UiButton
      class="filter-pill-trigger"
      :class="{ 'is-open': open }"
      :pressed="pill.active"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      {{ pill.text }}<UiIcon name="chevronDown" size="sm" />
    </UiButton>
    <div
      v-if="open"
      class="filter-pill-panel"
      role="group"
      :aria-label="pill.label"
    >
      <span class="filter-pill-heading">{{ pill.label }}</span>
      <div class="filter-pill-grid">
        <UiButton
          v-for="option in pill.options"
          :key="option.value"
          class="filter-pill-option"
          :pressed="option.value === pill.value"
          :label="option.label"
          @click="pick(option.value)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 浏览页的一个下拉筛选胶囊：胶囊上写「排序 · 综合 ▾」，选了值时高亮（反色）。
 * 点开是挂在胶囊下方的玻璃面板，选项排成网格，当前值反色（白底）；
 * 选一项、点外面、窗口失焦或 Esc（useEscapeLayer）都会关上。
 */
import { onBeforeUnmount, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import type { FilterPill } from '../utils/browse-filters'

defineProps<{ pill: FilterPill }>()
const emit = defineEmits<{ select: [value: string] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

useEscapeLayer(() => open.value, close)

function onPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

function close(): void {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', close)
}

function toggle(): void {
  if (open.value) return close()
  open.value = true
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', close)
}

function pick(value: string): void {
  close()
  emit('select', value)
}

onBeforeUnmount(close)
</script>

<style scoped>
.filter-pill {
  position: relative;
  display: inline-flex;
  flex: none;
}
.filter-pill-trigger :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.filter-pill-trigger.is-open {
  box-shadow: var(--focus-ring);
}
.filter-pill-panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  gap: var(--space-2_5);
  width: max-content;
  max-width: min(440px, 80vw);
  padding: var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.filter-pill-heading {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  letter-spacing: 0.1em;
}
.filter-pill-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(88px, 1fr));
  gap: var(--space-2);
}
.filter-pill-option {
  height: var(--control-height-lg);
  border-radius: var(--radius-lg);
}
</style>
