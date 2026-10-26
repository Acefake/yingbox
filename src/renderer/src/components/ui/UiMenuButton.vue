<template>
  <div ref="root" class="ui-menu-button">
    <UiButton
      :variant="variant"
      :size="size"
      :icon="icon"
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
      <UiListRow
        v-for="item in items"
        :key="item.key"
        class="ui-menu-button-item"
        role="menuitem"
        :disabled="item.disabled"
        @click="pick(item)"
      >
        <template v-if="item.icon" #leading>
          <UiIcon :name="item.icon" size="sm" />
        </template>
        {{ item.label }}
      </UiListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「更多」菜单按钮：页头工具条放不下的操作收进这里。
 * 触发钮是带图标 + 文字的 UiButton，菜单是浮层（--menu-bg：近乎不透明 + 背景模糊，压在海报上也读得清）里一列
 * UiListRow（role="menu" / "menuitem"），
 * 右对齐挂在按钮下方；选一项、点外面、窗口失焦或 Esc（useEscapeLayer）都会关上。
 */
import { onBeforeUnmount, ref } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'

import type { IconName } from './icons'
import UiButton from './UiButton.vue'
import UiIcon from './UiIcon.vue'
import UiListRow from './UiListRow.vue'

/** 菜单里的一项。 */
export interface MenuButtonItem {
  key: string
  label: string
  icon?: IconName
  disabled?: boolean
  /** 选中后执行；菜单先关再执行 */
  onSelect: () => void
}

withDefaults(
  defineProps<{
    items: MenuButtonItem[]
    label?: string
    icon?: IconName
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
</style>
