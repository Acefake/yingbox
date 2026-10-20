<template>
  <aside
    class="app-sidebar"
    :class="{ 'is-collapsed': collapsed, 'is-phone': isPhone }"
    aria-label="媒体中心导航"
  >
    <div class="sidebar-brand">
      <img class="brand-mark" :src="logoUrl" alt="" aria-hidden="true" />
      <span class="brand-name">{{ appName }}</span>
      <UiIconButton
        class="sidebar-toggle"
        icon="panel"
        size="sm"
        :label="minimized ? '展开侧边栏' : '收起侧边栏'"
        @click="minimized = !minimized"
      />
    </div>
    <nav class="sidebar-nav">
      <template v-for="group in navGroups" :key="group.key">
        <div v-if="group.divider" class="sidebar-divider" />
        <span v-if="group.heading" class="sidebar-heading">{{
          group.heading
        }}</span>
        <UiNavItem
          v-for="item in group.items"
          :key="item.path"
          class="sidebar-item"
          :label="item.label"
          :icon="item.icon"
          icon-size="lg"
          :active="item.active"
          :collapsed="collapsed"
          @click="emit('navigate', item.path)"
        />
      </template>
    </nav>
    <div class="sidebar-footer">
      <UiNavItem
        class="sidebar-item"
        data-queue-anchor
        :label="queueLabel"
        current="pressed"
        :active="queueOpen"
        :collapsed="collapsed"
        @click="emit('toggle-queue')"
      >
        <template #icon>
          <span class="footer-queue-icon" aria-hidden="true">
            <UiIcon name="list" size="lg" />
            <span v-if="queueBusy" class="footer-pulse" />
          </span>
        </template>
        刮削队列
        <template #trailing>
          <span v-if="activeCount > 0" class="footer-badge">{{
            activeCount
          }}</span>
        </template>
        <template #extra>
          <span
            v-if="processingCount > 0"
            class="footer-progress"
            :style="{
              width: Math.max(14, Math.round(progress * 100)) + '%',
            }"
          />
        </template>
      </UiNavItem>
      <!-- 可见文字「设置」，无障碍名称「打开设置」，active 只是外观，不输出 aria-current -->
      <UiNavItem
        class="sidebar-item"
        label="设置"
        aria-label="打开设置"
        icon="settings"
        icon-size="lg"
        current="none"
        :active="settingsOpen"
        :collapsed="collapsed"
        @click="emit('open-settings')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 应用侧栏：品牌、分组导航、页脚的刮削队列入口（带进度）和设置入口。
 * 桌面端可收起为图标栏（v-model:minimized），手机上由外壳当作抽屉显示。
 */
import { computed } from 'vue'

import logoUrl from '@/assets/imgs/logo.svg'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { usePlatform } from '@/composables/use-platform'
import { useLadaTasks } from '@/features/lada'

import type { NavGroup } from '../composables/nav-items'

defineProps<{
  /** 导航分组 */
  navGroups: NavGroup[]
  /** 实际是否以图标栏显示（手机上恒为 false） */
  collapsed: boolean
  /** 刮削队列面板是否打开 */
  queueOpen: boolean
  /** 设置窗口是否打开 */
  settingsOpen: boolean
}>()
const emit = defineEmits<{
  navigate: [path: string]
  'toggle-queue': []
  'open-settings': []
}>()

/** 用户是否选择收起侧栏（v-model:minimized） */
const minimized = defineModel<boolean>('minimized', { required: true })

const appName = '影盒'
const { isPhone } = usePlatform()

const { activeCount, processingCount, progress } = useGlobalQueue()
// 去码 / 边跑边看跟刮削队列同住一个面板，运行时按钮上一起给个提示
const { hasRuntime } = useLadaTasks()
const queueBusy = computed(() => processingCount.value > 0 || hasRuntime.value)
const queueLabel = computed(() =>
  processingCount.value > 0 || !hasRuntime.value
    ? '打开刮削队列'
    : '打开刮削队列（后台任务进行中）'
)
</script>

<style scoped>
/* ── 侧栏：桌面端在文档流里，不覆盖内容 ── */
.app-sidebar {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 var(--sidebar-width);
  flex-direction: column;
  width: var(--sidebar-width);
  max-width: var(--sidebar-width);
  height: 100%;
  min-height: 0;
  padding: var(--space-5) var(--space-3);
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  -webkit-app-region: no-drag;
  transition:
    width 150ms ease,
    flex-basis 150ms ease,
    max-width 150ms ease,
    transform 180ms ease;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 42px;
  padding: var(--space-1) var(--space-1) var(--space-5) var(--space-2);
  color: var(--text-primary);
}
.brand-mark {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
}
.brand-name {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-medium);
  letter-spacing: -0.01em;
}
.sidebar-toggle {
  margin-left: auto;
}

.sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-heading {
  padding: var(--space-4) var(--space-3) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}
.sidebar-divider {
  height: 1px;
  margin: var(--space-3) var(--space-3) 2px;
  background: var(--separator);
}

/* 导航项（UiNavItem，含页脚的刮削队列 / 设置）：侧栏版更高、更大字号，未选中为次要色 */
.sidebar-item {
  gap: var(--space-3);
  height: auto;
  min-height: 36px;
  padding: 0 var(--space-3);
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-md);
}
.sidebar-item:hover:not(:disabled),
.sidebar-item.is-active {
  color: var(--text-primary);
}
.sidebar-item :deep(.app-icon) {
  color: inherit;
}

.sidebar-footer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--separator);
}
.sidebar-footer .sidebar-item {
  font-size: var(--text-sm);
}
.footer-queue-icon {
  position: relative;
  display: inline-flex;
}
.footer-pulse {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  animation: queue-pulse 1.4s ease-out infinite;
}
@keyframes queue-pulse {
  70%,
  100% {
    box-shadow: 0 0 0 6px transparent;
  }
}
.footer-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 15px;
  height: 15px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: 15px;
  text-align: center;
  pointer-events: none;
}
.footer-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  opacity: 0.85;
  transition: width 0.35s var(--ease-out);
}

.app-sidebar.is-collapsed .sidebar-brand {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}
.app-sidebar.is-collapsed .brand-name,
.app-sidebar.is-collapsed .brand-mark,
.app-sidebar.is-collapsed .sidebar-heading {
  display: none;
}
.app-sidebar.is-collapsed .sidebar-toggle {
  margin-left: 0;
}
.app-sidebar.is-collapsed .sidebar-item {
  padding: 0;
}
.app-sidebar.is-collapsed .sidebar-divider {
  margin-right: var(--space-2);
  margin-left: var(--space-2);
}
.app-sidebar.is-phone .sidebar-toggle {
  display: none;
}
</style>
