<template>
  <!-- 应用主布局容器 -->
  <div
    class="app-layout h-screen w-screen overflow-hidden"
    :class="{
      'sidebar-collapsed': collapsed,
      'is-phone': isPhone,
      'is-web': isWeb,
      'sidebar-open': isPhone && sidebarOpen,
    }"
  >
    <div
      v-if="isPhone && sidebarOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="sidebarOpen = false"
    />
    <!-- 媒体中心侧栏 -->
    <AppSidebar
      v-model:minimized="sidebarCollapsed"
      :nav-groups="navGroups"
      :collapsed="collapsed"
      :queue-open="queuePanelVisible"
      :settings-open="settingsVisible"
      @navigate="navigateTo"
      @toggle-queue="queuePanelVisible = !queuePanelVisible"
      @open-settings="openGlobalSettings()"
    />

    <div class="shell-column">
      <!-- 主内容区域：铺满窗口，左侧与顶部让出浮动侧栏和胶囊 -->
      <main class="main-content">
        <div class="content-surface">
          <!-- 网页端：片库服务连不上 / 需要登录时，所有页面都先显示连接界面 -->
          <ServerConnect v-if="serverGate" :state="serverState" />
          <slot v-else />
        </div>
      </main>

      <!-- 顶部浮动胶囊（手机菜单、窗口键），整条保留窗口拖拽区域 -->
      <AppToolbar @open-menu="sidebarOpen = true" />
    </div>

    <!-- 全局设置面板（已融合数据源管理） -->
    <SettingsPanel
      :visible="settingsVisible"
      :initial-section="settingsInitialSection"
      @close="settingsVisible = false"
    />

    <!-- 全局后台任务面板（去码 / 边跑边看） -->
    <BackgroundTasksPanel
      :visible="queuePanelVisible"
      @close="queuePanelVisible = false"
    />

    <!-- 手机底部标签栏 -->
    <nav v-if="isPhone" class="bottom-nav" aria-label="主导航">
      <UiNavItem
        v-for="item in bottomNavItems"
        :key="item.key"
        class="bottom-nav-item"
        layout="stack"
        :label="item.label"
        :icon="item.icon"
        icon-size="lg"
        :active="item.active"
        :current="item.path ? 'page' : 'none'"
        :aria-expanded="item.path ? undefined : sidebarOpen"
        @click="item.path ? navigateTo(item.path) : (sidebarOpen = true)"
      />
    </nav>
  </div>
</template>

<script setup lang="ts">
/**
 * 应用外壳：主内容铺满窗口，上面浮着玻璃侧栏（含全局搜索与 AI 助手入口；可收起为 64px 图标列，
 * Cmd/Ctrl+B 切换并记住，见 sidebar-state.ts；手机上为抽屉）
 * 和顶部的手机菜单 / 窗口键胶囊；另有全局的设置窗口和后台任务浮层，手机上额外显示底部标签栏。
 * 内容区按 --shell-left / --shell-top 让出浮动控件，页面要铺到侧栏后面时可用这两个变量取负边距。
 * 侧栏、工具栏各自是组件，导航项与搜索规则是纯函数（composables/），这里只管布局状态与全局快捷键。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiNavItem from '@/components/ui/UiNavItem.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { usePlatform } from '@/composables/use-platform'
import { useCalendarBadge } from '@/features/calendar'
import { refreshSources } from '@/features/online'
import { SettingsPanel, useSetting } from '@/features/settings'
import { isWebRuntime, libraryServerState } from '@/services/library-server'

import AppSidebar from './components/AppSidebar.vue'
import AppToolbar from './components/AppToolbar.vue'
import BackgroundTasksPanel from './components/BackgroundTasksPanel.vue'
import ServerConnect from './components/ServerConnect.vue'
import {
  type NavState,
  buildBottomNav,
  buildNavGroups,
} from './composables/nav-items'
import {
  isSidebarShortcut,
  useSidebarCollapsed,
} from './composables/sidebar-state'

const router = useRouter()
const route = useRoute()

const { isElectron, isWeb, isPhone, hasLocalLibrary } = usePlatform()

/** 用户选择的收起状态（持久化，Cmd/Ctrl+B 切换） */
const sidebarCollapsed = useSidebarCollapsed()
const sidebarOpen = ref(false)

/** 桌面端收起侧栏时只显示图标，导航项改用悬停提示 */
const collapsed = computed(() => sidebarCollapsed.value && !isPhone.value)

// 网页端：片库服务连不上或需要登录时，内容区换成连接界面（桌面端不探测，始终是 unknown）
const serverState = libraryServerState()
const serverGate = computed(
  () =>
    isWebRuntime() &&
    (serverState.value === 'unauthorized' || serverState.value === 'offline')
)

const settingsVisible = ref(false)
const settingsInitialSection = ref('appearance')
const queuePanelVisible = ref(false)

// 成人模式（设置 app.adultMode，任一窗口切换后所有窗口同步）
const adultMode = useSetting('app.adultMode')
watch(adultMode, enabled => {
  // 关掉成人模式时离开成人页面（番号库、AV），不在屏幕上留下内容
  if (!enabled && route.meta.adultOnly) router.push('/')
})

// 追剧日历的未看新集数（侧栏角标）
const calendarBadge = useCalendarBadge()
const navState = computed<NavState>(() => ({
  routeName: route.name?.toString(),
  onlineTab: typeof route.query.tab === 'string' ? route.query.tab : undefined,
  hasLocalLibrary: hasLocalLibrary.value,
  hasNetdisk: isElectron,
  adultMode: adultMode.value,
  calendarBadge: calendarBadge.value,
}))
const navGroups = computed(() => buildNavGroups(navState.value))
const bottomNavItems = computed(() =>
  buildBottomNav(navState.value, sidebarOpen.value)
)

/**
 * 导航到指定路由（手机上顺带收起抽屉）
 * @param path - 目标路由路径
 */
const navigateTo = (path: string): void => {
  sidebarOpen.value = false
  router.push(path)
}

useEscapeLayer(
  () => sidebarOpen.value,
  () => (sidebarOpen.value = false)
)
const onSettingsShortcut = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openGlobalSettings()
  } else if (!isPhone.value && isSidebarShortcut(event)) {
    event.preventDefault()
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
}
const openGlobalSettings = (section = 'appearance'): void => {
  settingsInitialSection.value = section
  settingsVisible.value = true
}
const onOpenSettings = (event: Event): void => {
  const section = (event as CustomEvent<string>).detail
  openGlobalSettings(section || 'appearance')
}
if (typeof window !== 'undefined') {
  window.addEventListener('app:open-settings', onOpenSettings)
}

onMounted(() => {
  window.addEventListener('keydown', onSettingsShortcut)
  // 每次启动自动同步并检测数据源（静默，失败不影响其余功能）。
  // 浏览器/PWA 模式下跨域受限，检测会全部失败，因此仅在桌面端执行。
  if (isElectron) void refreshSources()
})

onUnmounted(() => {
  window.removeEventListener('app:open-settings', onOpenSettings)
  window.removeEventListener('keydown', onSettingsShortcut)
})
</script>

<style scoped>
.app-layout {
  --shell-left: calc(var(--shell-inset) + var(--sidebar-width));
  position: relative;
  background: var(--bg-main);
  color: var(--text-primary);
}
.app-layout:where(.sidebar-collapsed) {
  --shell-left: calc(var(--shell-inset) + var(--sidebar-width-collapsed));
}

.app-layout:where(.is-web) .app-sidebar,
.app-layout:where(.is-web) .top-menu {
  -webkit-app-region: no-drag;
}

/* ── 内容：铺满窗口，左侧 / 顶部让出浮动侧栏与胶囊 ── */
.shell-column {
  position: relative;
  height: 100%;
}
.main-content {
  height: 100%;
  overflow: hidden;
}
.content-surface {
  height: 100%;
  padding: var(--shell-top) 0 0 var(--shell-left);
  overflow: hidden;
  background: var(--bg-main);
  transition: padding var(--duration-fast) ease;
}

/* ── 手机：侧栏为抽屉，只在打开时覆盖内容 ── */
/* 窄屏：页面边距收窄，海报墙最小列宽与间距调小，390px 宽也能排 3 列 */
.app-layout.is-phone {
  --shell-left: 0px;
  --content-padding-x: var(--space-4);
  --poster-min-width: 104px;
  --poster-gap-x: var(--space-3);
  --poster-gap-y: var(--space-5);
}
.app-layout.is-phone .app-sidebar {
  position: fixed;
  inset: var(--shell-inset) auto var(--shell-inset) var(--shell-inset);
  z-index: var(--z-drawer);
  width: min(300px, 82vw);
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-3)
    calc(20px + var(--safe-bottom));
  transform: translateX(-120%);
  pointer-events: none;
}
.app-layout.is-phone.sidebar-open .app-sidebar {
  transform: translateX(0);
  pointer-events: auto;
}
.app-layout.is-phone .content-surface {
  padding-top: calc(var(--shell-top) + var(--safe-top));
  padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom));
}
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer-backdrop);
  background: var(--overlay-scrim-soft);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.bottom-nav {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-bottom-nav);
  display: flex;
  align-items: stretch;
  height: calc(var(--bottom-nav-height) + var(--safe-bottom));
  padding: 0 var(--space-2) var(--safe-bottom);
  border-top: 1px solid var(--separator);
  background: var(--bg-titlebar);
}
/* 底部标签项（UiNavItem layout="stack"）：等分宽度、撑满栏高 */
.bottom-nav-item {
  flex: 1;
  width: auto;
  min-height: var(--bottom-nav-height);
}
</style>
