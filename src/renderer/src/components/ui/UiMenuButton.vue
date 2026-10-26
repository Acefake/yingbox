<template>
  <div ref="root" class="ui-menu-button">
    <UiIconButton
      v-if="iconOnly"
      :variant="variant === 'glass' ? 'glass' : 'solid'"
      :size="size"
      :icon="icon ?? 'more'"
      :label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    />
    <UiButton
      v-else
      :variant="variant"
      :size="size"
      :icon="icon ?? undefined"
      :label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    />
    <div
      v-if="open"
      class="ui-menu-button-panel"
      role="menu"
      :aria-label="label"
    >
      <template v-for="(item, index) in items" :key="item.key">
        <div
          v-if="
            item.group !== undefined && item.group !== items[index - 1]?.group
          "
          class="ui-menu-button-group"
          :class="{ 'is-first': index === 0 }"
          role="presentation"
        >
          {{ item.group }}
        </div>
        <UiListRow
          class="ui-menu-button-item"
          :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
          :aria-checked="item.checked"
          :disabled="item.disabled"
          @click="pick(item)"
        >
          <template v-if="item.icon" #leading>
            <UiIcon :name="item.icon" size="sm" />
          </template>
          {{ item.label }}
          <template v-if="item.hint || item.checked" #trailing>
            <span v-if="item.hint" class="ui-menu-button-hint">{{
              item.hint
            }}</span>
            <UiIcon v-if="item.checked" name="check" size="sm" />
          </template>
        </UiListRow>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「更多」菜单按钮：页头工具条放不下的操作收进这里。
 * 触发钮是带图标 + 文字的 UiButton，菜单是浮层（--menu-bg：近乎不透明 + 背景模糊，压在海报上也读得清）里一列
 * UiListRow（role="menu" / "menuitem"），
 * 右对齐挂在按钮下方；选一项、点外面、窗口失焦或 Esc（useEscapeLayer）都会关上。
 *
 * - iconOnly：触发钮只放图标（UiIconButton solid，label 作读屏名与悬停提示），如页头的「⋯」。
 * - icon 传 null：文字触发钮不带图标（如排序钮「添加时间 ↓」）。
 * - 菜单项 group：连续同组的项上方显示一次组名（如「匹配状态」「媒体库」），相当于平铺的子菜单。
 * - 菜单项 checked：单选项（menuitemradio + aria-checked），选中的项尾部打勾；hint 是尾部的淡色说明。
 */
import { onBeforeUnmount, ref } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'

import type { IconName } from './icons'
import UiButton from './UiButton.vue'
import UiIcon from './UiIcon.vue'
import UiIconButton from './UiIconButton.vue'
import UiListRow from './UiListRow.vue'

/** 菜单里的一项。 */
export interface MenuButtonItem {
  key: string
  label: string
  icon?: IconName
  disabled?: boolean
  /** 所属分组的名字；连续同组的项上方显示一次 */
  group?: string
  /** 单选项的选中状态；不传表示普通操作项 */
  checked?: boolean
  /** 尾部的淡色说明（如当前排序方向） */
  hint?: string
  /** 选中后执行；菜单先关再执行 */
  onSelect: () => void
}

withDefaults(
  defineProps<{
    items: MenuButtonItem[]
    label?: string
    /** null 表示不带图标 */
    icon?: IconName | null
    /** 只显示图标 */
    iconOnly?: boolean
    variant?: 'secondary' | 'glass'
    size?: 'sm' | 'md'
  }>(),
  { label: '更多', icon: 'more', variant: 'secondary', size: 'md' }
)

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
  if (open.value) {
    close()
    return
  }
  open.value = true
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', close)
}

function pick(item: MenuButtonItem): void {
  close()
  item.onSelect()
}

onBeforeUnmount(close)
</script>

<style>
.ui-menu-button {
  position: relative;
  display: inline-flex;
  flex: none;
}
.ui-menu-button-panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-height: 70vh;
  overflow-y: auto;
  padding: var(--space-1_5);
  border-radius: var(--radius-lg);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.ui-menu-button-item {
  white-space: nowrap;
}
.ui-menu-button-group {
  margin-top: var(--space-1_5);
  padding: var(--space-2) var(--space-3) var(--space-1);
  border-top: 1px solid var(--border-glass-light);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.ui-menu-button-group.is-first {
  margin-top: 0;
  border-top: 0;
}
.ui-menu-button-hint {
  font-variant-numeric: tabular-nums;
}
</style>
