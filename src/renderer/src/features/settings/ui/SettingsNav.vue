<template>
  <!-- 左侧：搜索 + 分区导航 -->
  <aside class="settings-nav">
    <UiInput
      v-model="query"
      class="settings-search"
      variant="filled"
      size="sm"
      icon="search"
      placeholder="搜索设置"
      aria-label="搜索设置"
    />
    <nav class="settings-nav-list" aria-label="设置分区">
      <UiNavItem
        v-for="sec in sections"
        :key="sec.id"
        class="settings-nav-item"
        :label="sec.title"
        :icon="sec.icon"
        :active="activeId === sec.id"
        @click="emit('select', sec.id)"
      />
      <p v-if="sections.length === 0" class="settings-nav-empty">
        没有匹配的设置
      </p>
    </nav>
  </aside>
</template>

<script setup lang="ts">
/**
 * 设置窗口左侧栏：搜索框 + 分区导航。只负责展示，筛选与切换逻辑在 useSectionNavigation。
 */
import UiInput from '@/components/ui/UiInput.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'

import type { SettingsSection } from '../registry'

defineProps<{
  /** 当前可见（已按成人模式与搜索词筛选）的分区 */
  sections: SettingsSection[]
  /** 当前选中的分区 id */
  activeId?: string
}>()
const emit = defineEmits<{ select: [id: string] }>()

/** 搜索词（v-model:query） */
const query = defineModel<string>('query', { required: true })
</script>

<style scoped>
/* ── 左侧导航：靠底色和内容区分开，不画分隔线 ── */
.settings-nav {
  display: flex;
  flex: 0 0 216px;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-4) var(--space-3);
  background: var(--bg-glass);
}

.settings-search {
  flex: 0 0 auto;
  margin-bottom: var(--space-3);
}

.settings-nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-height: 0;
  overflow-y: auto;
}

/* 分区导航项即 UiNavItem 的默认外观，这里不再重复 */
.settings-nav-empty {
  margin: var(--space-2) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

/* ── 窄屏：顶部横向分区 ── */
@media (max-width: 720px) {
  .settings-nav {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
  }
  .settings-search {
    flex: 0 0 132px;
    margin-bottom: 0;
  }
  .settings-nav-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings-nav-item {
    flex: 0 0 auto;
    width: auto;
  }
  .settings-nav-empty {
    display: none;
  }
}
</style>
