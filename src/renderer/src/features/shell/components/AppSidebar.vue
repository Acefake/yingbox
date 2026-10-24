<template>
  <aside
    class="app-sidebar"
    :class="{ 'is-collapsed': collapsed, 'is-phone': isPhone }"
    aria-label="媒体中心导航"
  >
    <div class="sidebar-brand">
      <img class="brand-mark" :src="logoUrl" alt="" aria-hidden="true" />
      <span class="brand-name">{{ appName }}</span>
      <span v-if="incognito" class="sidebar-incognito" role="status">
        <UiIcon name="eyeOff" size="sm" />无痕
      </span>
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
          :label="navLabel(item)"
          :icon="item.icon"
          icon-size="lg"
          :active="item.active"
          :collapsed="collapsed"
          @click="emit('navigate', item.path)"
        >
          {{ item.label }}
          <template v-if="item.badge" #trailing>
            <span class="sidebar-badge" aria-hidden="true">{{
              badgeText(item.badge)
            }}</span>
          </template>
        </UiNavItem>
      </template>
    </nav>
    <div class="sidebar-footer">
      <UiNavItem
        class="sidebar-item"
        :label="incognito ? '关闭无痕模式' : '开启无痕模式'"
        current="pressed"
        :active="incognito"
        :collapsed="collapsed"
        @click="toggleIncognito"
      >
        <template #icon>
          <span class="footer-incognito-icon" aria-hidden="true">
            <UiIcon name="eyeOff" size="lg" />
            <span v-if="incognito" class="footer-dot" />
          </span>
        </template>
        无痕模式
      </UiNavItem>
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
            <span
              v-if="identifying"
              class="footer-ring"
              :style="{ '--ring-progress': identifying.progress ?? 0 }"
            />
            <span v-else-if="hasRuntime" class="footer-pulse" />
          </span>
        </template>
        后台任务
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
 * 应用侧栏：品牌、分组导航、页脚的无痕模式开关（会话级，打开时品牌旁显示「无痕」标识、
 * 收起成图标栏时图标带圆点）、后台任务入口（运行时带提示：媒体库识别显示进度环，
 * 去码 / 边跑边看显示呼吸点）和设置入口。
 * 桌面端可收起为图标栏（v-model:minimized），手机上由外壳当作抽屉显示。
 */
import { computed } from 'vue'

import logoUrl from '@/assets/imgs/logo.svg'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import { usePlatform } from '@/composables/use-platform'
import { incognitoState, toggleIncognito } from '@/features/incognito'
import { useLadaTasks } from '@/features/lada'
import { useIdentifyActivity } from '@/features/library'

import type { NavGroup, NavItem } from '../composables/nav-items'

defineProps<{
  /** 导航分组 */
  navGroups: NavGroup[]
  /** 实际是否以图标栏显示（手机上恒为 false） */
  collapsed: boolean
  /** 后台任务面板是否打开 */
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
const incognito = incognitoState()

// 去码 / 边跑边看在后台跑时，按钮上给个提示
const { hasRuntime } = useLadaTasks()
// 媒体库识别在跑时，按钮上显示进度环（进度条不再挤在各分区页面上）
const identifying = useIdentifyActivity()
/** 带角标的导航项：无障碍名称和收起时的悬停提示带上数字 */
const navLabel = (item: NavItem): string =>
  item.badge ? `${item.label}（${item.badge} 集未看）` : item.label
const badgeText = (count: number): string =>
  count > 99 ? '99+' : String(count)

const queueLabel = computed(() => {
  if (identifying.value) return `打开后台任务（${identifying.value.label}）`
  return hasRuntime.value ? '打开后台任务（进行中）' : '打开后台任务'
})
</script>

<style scoped>
/* ── 侧栏：桌面端在文档流里，不覆盖内容 ── */
.app-sidebar {
  position: relative;
  z-index: var(--z-raised);
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
    width var(--duration-fast) ease,
    flex-basis var(--duration-fast) ease,
    max-width var(--duration-fast) ease,
    transform var(--duration-fast) ease;
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
  gap: var(--space-0_5);
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
  margin: var(--space-3) var(--space-3) var(--space-0_5);
  background: var(--separator);
}

/* 导航项（UiNavItem，含页脚的后台任务 / 设置）：侧栏版更高、更大字号，未选中为次要色 */
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

/* 数字角标（追剧日历的未看新集数）：收起成图标栏时缩成图标右上角的小圆点数字 */
.sidebar-badge {
  flex: 0 0 auto;
  min-width: 18px;
  margin-left: auto;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--danger);
  color: var(--text-on-accent);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.app-sidebar.is-collapsed .sidebar-badge {
  position: absolute;
  top: var(--space-0_5);
  right: var(--space-0_5);
  min-width: 14px;
  padding: 0 var(--space-0_5);
  line-height: 14px;
}

.sidebar-footer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-0_5);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--separator);
}
.sidebar-footer .sidebar-item {
  font-size: var(--text-sm);
}
.footer-queue-icon,
.footer-incognito-icon {
  position: relative;
  display: inline-flex;
}
/* 无痕标识：品牌名旁的小胶囊；收起成图标栏时只剩开关图标上的圆点 */
.sidebar-incognito {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
}
.footer-dot {
  position: absolute;
  top: calc(var(--space-0_5) * -1);
  right: calc(var(--space-0_5) * -1);
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
}
.footer-pulse {
  position: absolute;
  top: calc(var(--space-0_5) * -1);
  right: calc(var(--space-0_5) * -1);
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  animation: queue-pulse var(--duration-pulse) ease-out infinite;
}
/* 识别进度环：conic-gradient 画出已完成的弧，中间挖空成环 */
.footer-ring {
  position: absolute;
  top: calc(var(--space-1) * -1);
  right: calc(var(--space-1) * -1);
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: conic-gradient(
    var(--accent) calc(var(--ring-progress) * 1turn),
    var(--bg-fill-secondary) 0
  );
  /* 遮罩只看不透明度：外圈保留、中间 2.5px 挖空 */
  mask: radial-gradient(circle, transparent 2.5px, var(--accent) 3px);
  transition: background var(--duration-normal) var(--ease-out);
}
@keyframes queue-pulse {
  70%,
  100% {
    box-shadow: 0 0 0 6px transparent;
  }
}

.app-sidebar.is-collapsed .sidebar-brand {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}
.app-sidebar.is-collapsed .brand-name,
.app-sidebar.is-collapsed .sidebar-incognito,
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
