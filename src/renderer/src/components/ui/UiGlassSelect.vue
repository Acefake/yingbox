<template>
  <div ref="root" class="ui-glass-select">
    <UiButton
      class="ui-glass-select-trigger"
      :class="{ 'is-open': open }"
      :variant="variant"
      :size="size"
      :pressed="active"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-controls="panelId"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <span class="ui-glass-select-text">{{ triggerText }}</span>
      <UiIcon name="chevronDown" size="sm" />
    </UiButton>
    <Teleport to="body">
      <div
        v-if="open"
        :id="panelId"
        ref="panel"
        class="ui-glass-select-panel"
        :style="place"
        role="dialog"
        :aria-label="label"
      >
        <span class="ui-glass-select-heading">{{ label }}</span>
        <div class="ui-glass-select-grid" :style="gridStyle">
          <UiButton
            v-for="option in options"
            :key="option.value"
            v-tooltip="option.title"
            class="ui-glass-select-option"
            :pressed="option.value === modelValue"
            :label="option.label"
            @click="pick(option.value)"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
/**
 * 玻璃下拉胶囊：胶囊上写「排序 · 综合 ▾」（或调用方给的 text），点开是挂在胶囊下方的玻璃面板，
 * 选项排成网格，当前值反色；选一项、点外面、页面滚动、窗口失焦或 Esc（useEscapeLayer）都会关上。
 * 面板挂到 body、按胶囊位置 fixed 定位（下方放不下时翻到上方），设置面板等滚动区不会把它裁掉。
 * 浏览页的筛选、设置里的追更偏好、追更面板每行的「跟随 / 单独设」都用它。
 * 每次选择都会发 update:modelValue（选中当前值也发），调用方可以用来重新打开对应的编辑。
 */
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'

import { vTooltip } from './tooltip'
import UiButton from './UiButton.vue'
import UiIcon from './UiIcon.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

/** 一个选项 */
export interface GlassSelectOption<V extends string = string> {
  value: V
  label: string
  /** 悬停提示 */
  title?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: T
    options: GlassSelectOption<T>[]
    /** 面板标题，也是无障碍名称的前半 */
    label: string
    /** 胶囊上的文字；不传时为「label · 当前选项」 */
    text?: string
    /** 高亮胶囊（如筛选条件动过） */
    active?: boolean
    /** 网格列数；不传时最多 4 列 */
    columns?: number
    variant?: 'secondary' | 'glass' | 'plain'
    size?: 'sm' | 'md'
    /** 面板贴左还是贴右展开 */
    align?: 'left' | 'right'
    disabled?: boolean
  }>(),
  {
    text: undefined,
    active: undefined,
    columns: undefined,
    variant: 'secondary',
    size: 'md',
    align: 'left',
  }
)
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const panelId = useId()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
/** 面板位置（打开时按胶囊的位置算） */
const place = ref<Record<string, string>>({})

const current = computed(() =>
  props.options.find(o => o.value === props.modelValue)
)
const triggerText = computed(
  () => props.text ?? `${props.label} · ${current.value?.label ?? ''}`
)
const ariaLabel = computed(() =>
  current.value ? `${props.label}：${current.value.label}` : props.label
)
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.columns ?? Math.min(4, props.options.length)}, minmax(88px, 1fr))`,
}))

useEscapeLayer(() => open.value, close)

const inside = (target: EventTarget | null): boolean =>
  !!root.value?.contains(target as Node) ||
  !!panel.value?.contains(target as Node)

function onPointerDown(event: PointerEvent): void {
  if (!inside(event.target)) close()
}

function onScroll(event: Event): void {
  if (!inside(event.target)) close()
}

function close(): void {
  if (!open.value) return
  if (panel.value?.contains(document.activeElement))
    root.value?.querySelector('button')?.focus()
  open.value = false
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
}

/** 面板贴在胶囊下方（下面放不下且上面更宽时翻到上方），左对齐或右对齐 */
function measure(): void {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  const gap = 8
  const below = window.innerHeight - rect.bottom - gap * 2
  const above = rect.top - gap * 2
  const up = below < 200 && above > below
  place.value = {
    ...(up
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
    ...(props.align === 'right'
      ? { right: `${window.innerWidth - rect.right}px` }
      : { left: `${rect.left}px` }),
  }
}

function toggle(): void {
  if (open.value) return close()
  measure()
  open.value = true
  void nextTick(() =>
    panel.value
      ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"], button')
      ?.focus()
  )
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
}

function pick(value: T): void {
  close()
  emit('update:modelValue', value)
}

onBeforeUnmount(close)
</script>

<style scoped>
.ui-glass-select {
  position: relative;
  display: inline-flex;
  flex: none;
  min-width: 0;
}
.ui-glass-select-trigger {
  max-width: 280px;
}
.ui-glass-select-trigger :deep(span:not(.ui-glass-select-text)) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}
.ui-glass-select-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:where(.ui-glass-select-trigger.is-open) {
  box-shadow: var(--focus-ring);
}
.ui-glass-select-panel {
  position: fixed;
  z-index: var(--z-dialog);
  display: flex;
  flex-direction: column;
  gap: var(--space-2_5);
  box-sizing: border-box;
  width: max-content;
  max-width: min(440px, 80vw);
  padding: var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  color: var(--text-primary);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.ui-glass-select-heading {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  letter-spacing: 0.1em;
}
.ui-glass-select-grid {
  display: grid;
  gap: var(--space-2);
}
.ui-glass-select-option {
  height: var(--control-height-lg);
  border-radius: var(--radius-lg);
}
</style>
