<template>
  <!-- 左侧：搜索 + 分区导航（实色卡片，图标放在彩色小方块里） -->
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
        :active="activeId === sec.id"
        @click="emit('select', sec.id)"
      >
        <template #icon>
          <span
            class="settings-nav-tile"
            :style="{ background: TINT_COLOR[sec.tint ?? 'gray'] }"
            aria-hidden="true"
          >
            <UiIcon :name="sec.icon" size="sm" />
          </span>
        </template>
        <template v-if="badges?.[sec.id]" #trailing>
          <span class="settings-nav-badge">{{ badges[sec.id] }}</span>
        </template>
      </UiNavItem>
      <p v-if="sections.length === 0" class="settings-nav-empty">
        没有匹配的设置
      </p>
    </nav>
  </aside>
</template>

<script setup lang="ts">
/**
 * 设置窗口左侧栏：搜索框 + 分区导航（Apple 设置式彩色图标块，badges 给分区挂红色计数，如软件更新）。
 * 只负责展示，筛选与切换逻辑在 useSectionNavigation。
 */
import UiIcon from '@/components/ui/UiIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'

import type { SettingsSection, SettingsTint } from '../registry'

defineProps<{
  /** 当前可见（已按成人模式与搜索词筛选）的分区 */
  sections: SettingsSection[]
  /** 当前选中的分区 id */
  activeId?: string
  /** 分区 id → 红色计数角标（0 或缺省不显示） */
  badges?: Record<string, number>
}>()
const emit = defineEmits<{ select: [id: string] }>()

/** 搜索词（v-model:query） */
const query = defineModel<string>('query', { required: true })

/** 图标块底色 → tokens.css 里的颜色令牌 */
const TINT_COLOR: Record<SettingsTint, string> = {
  indigo: 'var(--tint-indigo)',
  teal: 'var(--tint-teal)',
  orange: 'var(--warning)',
  green: 'var(--success)',
  red: 'var(--danger)',
  blue: 'var(--accent)',
  purple: 'var(--tint-purple)',
  pink: 'var(--favorite)',
  gray: 'var(--tint-gray)',
}
</script>

<style scoped>
/* ── 左侧导航：实色圆角卡片，高度随内容 ── */
.settings-nav {
  display: flex;
  flex: 0 0 260px;
  flex-direction: column;
  align-self: flex-start;
  max-height: 100%;
  min-height: 0;
  padding: var(--space-2_5);
  border-radius: var(--radius-xl);
  background: var(--bg-fill-tertiary);
}

.settings-search {
  flex: 0 0 auto;
  margin-bottom: var(--space-1_5);
}

.settings-search.ui-field {
  height: 36px;
  border-radius: var(--radius-lg);
}

.settings-nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-height: 0;
  overflow-y: auto;
}

.settings-nav-item.ui-nav-item {
  height: 42px;
  gap: var(--space-3);
  padding: 0 var(--space-2_5);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-size: var(--text-md);
}

.settings-nav-item.ui-nav-item.is-active {
  background: var(--bg-active);
  font-weight: var(--font-weight-semibold);
}

.settings-nav-tile {
  display: grid;
  flex: 0 0 28px;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  color: var(--text-on-accent);
}

.settings-nav-tile .app-icon {
  color: inherit;
}

.settings-nav-badge {
  min-width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--danger);
  color: var(--text-on-accent);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  text-align: center;
}

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
    align-self: stretch;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
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
  .settings-nav-item.ui-nav-item {
    flex: 0 0 auto;
    width: auto;
  }
  .settings-nav-empty {
    display: none;
  }
}
</style>
