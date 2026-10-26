<template>
  <UiPressable
    v-if="collapsed"
    v-tooltip.right="`${label}（${ENTRY_HOTKEY_LABEL}）`"
    class="sidebar-tool"
    :label="label"
    aria-haspopup="dialog"
    :aria-expanded="assistantOpen"
    @click="openAssistant"
  >
    <UiIcon name="search" size="lg" />
  </UiPressable>
  <UiPressable
    v-else
    class="sidebar-search"
    :label="`${label}（${ENTRY_HOTKEY_LABEL}）`"
    aria-haspopup="dialog"
    :aria-expanded="assistantOpen"
    @click="openAssistant"
  >
    <UiIcon name="search" size="md" />
    <span class="sidebar-search-text" aria-hidden="true">{{ label }}</span>
    <kbd v-if="!isPhone" class="sidebar-kbd" aria-hidden="true">{{
      ENTRY_HOTKEY_LABEL
    }}</kbd>
  </UiPressable>
</template>

<script setup lang="ts">
/**
 * 侧栏里的统一入口：外观是一条搜索框（放大镜 + 「搜索或问 AI」+ 快捷键键帽），其实是一个按钮，
 * 点它（或 Cmd/Ctrl+K）打开搜索与 AI 助手共用的居中浮层（features/assistant）。侧栏收起成图标列时只剩放大镜圆钮。
 * 网页版不能问 AI，文字只写「搜索片库」。
 */
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { usePlatform } from '@/composables/use-platform'
import { aiAvailable } from '@/features/ai'
import {
  ENTRY_HOTKEY_LABEL,
  assistantOpen,
  openAssistant,
} from '@/features/assistant'

defineProps<{
  /** 侧栏是否收起成图标列 */
  collapsed: boolean
}>()

const { isPhone } = usePlatform()
const label = aiAvailable() ? '搜索或问 AI' : '搜索片库'
</script>

<style scoped>
.sidebar-search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: 36px;
  padding: 0 var(--space-2) 0 var(--space-3);
  border-radius: var(--radius-full);
  background: var(--bg-glass-hover);
  box-shadow: inset 0 0 0 0.5px var(--border-glass);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  transition: var(--transition-fast);
}
.sidebar-search:hover {
  background: var(--bg-active);
  color: var(--text-secondary);
}
.sidebar-search:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.sidebar-search-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-kbd {
  flex: none;
  padding: 1px var(--space-1_5);
  border: 0.5px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
}
</style>
