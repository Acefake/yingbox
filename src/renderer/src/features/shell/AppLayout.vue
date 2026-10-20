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
      <!-- 顶部工具栏，保留窗口拖拽区域 -->
      <AppToolbar @open-menu="sidebarOpen = true" />

      <!-- 主内容区域 -->
      <main class="main-content">
        <div class="content-surface">
          <slot />
        </div>
      </main>
    </div>

    <!-- 全局设置面板（已融合数据源管理） -->
    <SettingsPanel
      :visible="settingsVisible"
      :initial-section="settingsInitialSection"
      @close="settingsVisible = false"
    />

    <!-- 全局刮削队列面板 -->
    <ScrapeQueuePanel
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
 * 应用外壳：组合侧栏（可收起为图标栏，手机上为抽屉）、顶部工具栏、主内容插槽，
 * 以及全局的设置窗口和刮削队列浮层。手机上额外显示底部标签栏。
 * 侧栏、工具栏各自是组件，导航项与搜索规则是纯函数（composables/），这里只管布局状态与全局快捷键。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ScrapeQueuePanel from '@/components/ScrapeQueuePanel.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import { usePlatform } from '@/composables/use-platform'
import { refreshSources } from '@/features/online'
import { SettingsPanel, useSetting } from '@/features/settings'

import AppSidebar from './components/AppSidebar.vue'
import AppToolbar from './components/AppToolbar.vue'
import {
  type NavState,
  buildBottomNav,
  buildNavGroups,
} from './composables/nav-items'

const router = useRouter()
const route = useRoute()

const { isElectron, isWeb, isPhone, hasLocalLibrary } = usePlatform()

const sidebarCollapsed = ref(false)
const sidebarOpen = ref(false)

/** 桌面端收起侧栏时只显示图标，导航项改用悬停提示 */
const collapsed = computed(() => sidebarCollapsed.value && !isPhone.value)

const settingsVisible = ref(false)
const settingsInitialSection = ref('appearance')
const queuePanelVisible = ref(false)

// 成人模式（设置 app.adultMode，任一窗口切换后所有窗口同步）
const adultMode = useSetting('app.adultMode')
watch(adultMode, enabled => {
  if (!enabled && ['/av', '/amane'].includes(route.path)) router.push('/')
})

const navState = computed<NavState>(() => ({
  routeName: route.name?.toString(),
  onlineTab: typeof route.query.tab === 'string' ? route.query.tab : undefined,
  hasLocalLibrary: hasLocalLibrary.value,
  adultMode: adultMode.value,
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

const onDrawerEscape = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && sidebarOpen.value) sidebarOpen.value = false
}
const onSettingsShortcut = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openGlobalSettings()
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
  window.addEventListener('keydown', onDrawerEscape)
  // 每次启动自动同步并检测数据源（静默，失败不影响其余功能）。
  // 浏览器/PWA 模式下跨域受限，检测会全部失败，因此仅在桌面端执行。
  if (isElectron) void refreshSources()
})

onUnmounted(() => {
  window.removeEventListener('app:open-settings', onOpenSettings)
  window.removeEventListener('keydown', onSettingsShortcut)
  window.removeEventListener('keydown', onDrawerEscape)
})
</script>

<style scoped>
.app-layout {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  background: var(--bg-main);
  color: var(--text-primary);
}

.app-layout.is-web .app-sidebar,
.app-layout.is-web .top-menu {
  -webkit-app-region: no-drag;
}

/* ── 右侧：工具栏 + 内容 ── */
.shell-column {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.main-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.content-surface {
  height: 100%;
  overflow: hidden;
  background: var(--bg-main);
}

/* ── 收起侧栏：只留图标，文字改为悬停提示 ── */
.app-layout.sidebar-collapsed .app-sidebar {
  flex-basis: var(--sidebar-width-collapsed);
  width: var(--sidebar-width-collapsed);
  max-width: var(--sidebar-width-collapsed);
  padding-right: var(--space-3);
  padding-left: var(--space-3);
}

/* ── 手机：侧栏为抽屉，只在打开时覆盖内容 ── */
.app-layout.is-phone {
  flex-direction: column;
}
.app-layout.is-phone .app-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: var(--z-drawer);
  flex: none;
  width: min(320px, 86vw);
  max-width: min(320px, 86vw);
  height: 100%;
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-3)
    calc(20px + var(--safe-bottom));
  box-shadow: var(--shadow-lg);
  transform: translateX(-110%);
  pointer-events: none;
}
.app-layout.is-phone.sidebar-open .app-sidebar {
  transform: translateX(0);
  pointer-events: auto;
}
.app-layout.is-phone .shell-column {
  width: 100%;
  padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom));
}
.app-layout.is-phone .top-menu {
  flex-basis: calc(var(--titlebar-height) + var(--safe-top));
  height: calc(var(--titlebar-height) + var(--safe-top));
  padding-top: var(--safe-top);
  -webkit-app-region: no-drag;
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

/* 未识别为手机但窗口很窄时：侧栏收进屏幕外，保持内容可用 */
@media (max-width: 768px) {
  .app-layout:not(.is-phone) {
    flex-direction: column;
  }
  .app-layout:not(.is-phone) .app-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: var(--z-drawer);
    flex: none;
    width: min(320px, 86vw);
    max-width: min(320px, 86vw);
    height: 100%;
    transform: translateX(-110%);
    pointer-events: none;
  }
  .app-layout:not(.is-phone) .shell-column {
    width: 100%;
    padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom));
  }
  .app-layout:not(.is-phone) .top-menu {
    height: calc(var(--titlebar-height) + var(--safe-top));
    padding-top: var(--safe-top);
  }
}
</style>
