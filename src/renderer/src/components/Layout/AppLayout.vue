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
    <aside class="app-sidebar" aria-label="媒体中心导航">
      <div class="sidebar-brand">
        <img class="brand-mark" :src="logoUrl" alt="" aria-hidden="true" />
        <span class="brand-name">{{ appName }}</span>
        <UiIconButton
          class="sidebar-toggle"
          icon="panel"
          size="sm"
          :label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
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
            @click="navigateTo(item.path)"
          />
        </template>
      </nav>
      <div class="sidebar-footer">
        <UiNavItem
          class="sidebar-item"
          data-queue-anchor
          :label="queueLabel"
          current="pressed"
          :active="queuePanelVisible"
          :collapsed="collapsed"
          @click="queuePanelVisible = !queuePanelVisible"
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
          :active="settingsVisible"
          :collapsed="collapsed"
          @click="openGlobalSettings()"
        />
      </div>
    </aside>

    <div class="shell-column">
      <!-- 顶部工具栏，保留窗口拖拽区域 -->
      <header class="top-menu">
        <div class="menu-content">
          <div class="toolbar-leading">
            <UiIconButton
              v-if="isPhone"
              icon="menu"
              label="打开菜单"
              @click="sidebarOpen = true"
            />
            <UiIconButton icon="back" label="后退" @click="navigateBack" />
            <UiIconButton
              v-if="!isPhone"
              icon="forward"
              label="前进"
              @click="router.forward()"
            />
            <UiIconButton
              v-if="!isPhone"
              icon="refresh"
              label="刷新"
              @click="router.go(0)"
            />
            <div
              class="global-search"
              role="search"
              :aria-label="globalSearchPlaceholder"
            >
              <UiInput
                ref="globalSearchInput"
                v-model="globalSearch"
                class="global-search-field"
                variant="filled"
                clearable
                clear-label="清空搜索"
                :placeholder="globalSearchPlaceholder"
                @keydown.enter.prevent="submitGlobalSearch"
                @clear="clearGlobalSearch"
              >
                <template #leading><UiIcon name="search" size="md" /></template>
              </UiInput>
            </div>
          </div>

          <!-- 右侧：窗口控制 -->
          <div class="window-section">
            <WinControls :show-window-buttons="isElectron" />
          </div>
        </div>
      </header>

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
 * 应用外壳：左侧导航栏（可收起为图标栏，手机上为抽屉）、顶部工具栏（前进后退、全局搜索、窗口控制）、
 * 主内容插槽，以及全局的设置窗口和刮削队列浮层。手机上额外显示底部标签栏。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import logoUrl from '@/assets/imgs/logo.svg'
import ScrapeQueuePanel from '@/components/ScrapeQueuePanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import WinControls from '@/components/WinControls.vue'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { useLadaTasks } from '@/composables/use-lada-tasks'
import { usePlatform } from '@/composables/use-platform'
import { refreshSources } from '@/composables/use-source-refresh'

const router = useRouter()
const route = useRoute()

const { isElectron, isWeb, isPhone, hasLocalLibrary } = usePlatform()

// 从 package.json 获取应用名称
const appName = ref('影盒')
const sidebarCollapsed = ref(false)
const sidebarOpen = ref(false)

/** 桌面端收起侧栏时只显示图标，导航项改用悬停提示 */
const collapsed = computed(() => sidebarCollapsed.value && !isPhone.value)

const settingsVisible = ref(false)
const settingsInitialSection = ref('appearance')
const queuePanelVisible = ref(false)
const { activeCount, processingCount, progress } = useGlobalQueue()
// 去码 / 边跑边看跟刮削队列同住一个面板，运行时按钮上一起给个提示
const { hasRuntime } = useLadaTasks()
const queueBusy = computed(() => processingCount.value > 0 || hasRuntime.value)
const queueLabel = computed(() =>
  processingCount.value > 0 || !hasRuntime.value
    ? '打开刮削队列'
    : '打开刮削队列（后台任务进行中）'
)
const globalSearch = ref('')
const globalSearchInput = ref<InstanceType<typeof UiInput> | null>(null)
const globalSearchPlaceholder = computed(() => {
  if (isPhone.value) {
    if (route.name === 'Movie') return '搜索本地电影'
    if (route.name === 'TV') return '搜索本地电视剧'
    if (route.name === 'Amane') return '搜索 Amane 片库'
    if (route.name === 'AV') return '搜索 AV 资源'
    return '搜索'
  }
  if (route.name === 'Movie') return '搜索本地电影（Ctrl + K）'
  if (route.name === 'TV') return '搜索本地电视剧（Ctrl + K）'
  if (route.name === 'Amane') return '搜索 Amane 片库（Ctrl + K）'
  if (route.name === 'AV') return '搜索 AV 资源（Ctrl + K）'
  return '搜索电影、电视剧（Ctrl + K）'
})

watch(
  () => route.query.q,
  query => {
    globalSearch.value = typeof query === 'string' ? query : ''
  },
  { immediate: true }
)

/**
 * 导航到指定路由
 * @param path - 目标路由路径
 */
const navigateTo = (path: string): void => {
  sidebarOpen.value = false
  router.push(path)
}

const navigateBack = (): void => {
  const event = new CustomEvent('app:navigate-back', { cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) router.back()
}

const submitGlobalSearch = (): void => {
  const query = globalSearch.value.trim()
  if (query.toLowerCase() === 'getav') {
    toggleAdultMode()
    globalSearch.value = ''
    return
  }
  if (route.name === 'Movie' || route.name === 'TV' || route.name === 'Amane') {
    router.replace({ path: route.path, query: query ? { q: query } : {} })
    return
  }
  const targetPath = route.name === 'AV' ? '/av' : '/'
  router.replace({
    path: targetPath,
    query: query ? { tab: 'search', q: query } : { tab: 'search' },
  })
}

const clearGlobalSearch = (): void => {
  globalSearch.value = ''
  if (route.name === 'Movie' || route.name === 'TV' || route.name === 'Amane')
    router.replace({ path: route.path })
  else
    router.replace({
      path: route.name === 'AV' ? '/av' : '/',
      query: { tab: 'search' },
    })
  nextTick(() => globalSearchInput.value?.focus())
}

// 成人模式检测
const adultMode = ref(localStorage.getItem('adultMode') === '1')

interface NavItem {
  label: string
  icon: IconName
  path: string
  active: boolean
}
interface NavGroup {
  key: string
  heading?: string
  divider?: boolean
  items: NavItem[]
}

const isOnlineTab = (tab?: string): boolean =>
  route.name === 'Online' && (tab ? route.query.tab === tab : !route.query.tab)

/** 侧栏导航分组；本地媒体只在有本地片库的平台显示，Amane / AV 只在成人模式下出现 */
const navGroups = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [
    {
      key: 'library',
      heading: '资料库',
      items: [
        { label: '首页', icon: 'home', path: '/', active: isOnlineTab() },
        {
          label: '最近播放',
          icon: 'history',
          path: '/?tab=recent',
          active: isOnlineTab('recent'),
        },
        {
          label: '我的收藏',
          icon: 'heart',
          path: '/?tab=favorites',
          active: isOnlineTab('favorites'),
        },
      ],
    },
  ]
  const local: NavItem[] = []
  if (hasLocalLibrary.value) {
    local.push(
      {
        label: '电影',
        icon: 'movie',
        path: '/movie',
        active: route.name === 'Movie',
      },
      { label: '电视剧', icon: 'tv', path: '/tv', active: route.name === 'TV' }
    )
    if (adultMode.value)
      local.push({
        label: 'Amane',
        icon: 'database',
        path: '/amane',
        active: route.name === 'Amane',
      })
  }
  if (local.length)
    groups.push({
      key: 'local',
      heading: '本地媒体',
      divider: true,
      items: local,
    })
  if (adultMode.value)
    groups.push({
      key: 'adult',
      items: [
        {
          label: 'AV资源',
          icon: 'av',
          path: '/av',
          active: route.name === 'AV',
        },
      ],
    })
  return groups
})

/** 手机底部标签栏；「菜单」没有 path，点击打开侧栏抽屉 */
const bottomNavItems = computed(() => [
  {
    key: 'home',
    label: '首页',
    icon: 'home' as IconName,
    path: '/',
    active: isOnlineTab(),
  },
  {
    key: 'favorites',
    label: '收藏',
    icon: 'heart' as IconName,
    path: '/?tab=favorites',
    active: isOnlineTab('favorites'),
  },
  ...(hasLocalLibrary.value
    ? [
        {
          key: 'movie',
          label: '电影',
          icon: 'movie' as IconName,
          path: '/movie',
          active: route.name === 'Movie',
        },
      ]
    : []),
  {
    key: 'menu',
    label: '菜单',
    icon: 'menu' as IconName,
    path: '',
    active: sidebarOpen.value,
  },
])

// 监听自定义事件（同页面内切换）和跨 Tab storage 事件
const handleAdultModeChange = (enabled: boolean): void => {
  adultMode.value = enabled
  if (!enabled && ['/av', '/amane'].includes(route.path)) {
    router.push('/')
  }
}
const toggleAdultMode = (): void => {
  const enabled = !adultMode.value
  localStorage.setItem('adultMode', enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent('adultModeChange', { detail: enabled }))
}
const onAdultModeChange = (e: Event): void => {
  handleAdultModeChange((e as CustomEvent<boolean>).detail)
}
const onStorageChange = (e: StorageEvent): void => {
  if (e.key === 'adultMode') handleAdultModeChange(e.newValue === '1')
}
const onGlobalSearchShortcut = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    globalSearchInput.value?.focus()
  }
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
  window.addEventListener('adultModeChange', onAdultModeChange)
  window.addEventListener('storage', onStorageChange)
  window.addEventListener('app:open-settings', onOpenSettings)
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalSearchShortcut)
  window.addEventListener('keydown', onSettingsShortcut)
  window.addEventListener('keydown', onDrawerEscape)
  // 每次启动自动同步并检测数据源（静默，失败不影响其余功能）。
  // 浏览器/PWA 模式下跨域受限，检测会全部失败，因此仅在桌面端执行。
  if (isElectron) void refreshSources()
})

onUnmounted(() => {
  window.removeEventListener('adultModeChange', onAdultModeChange)
  window.removeEventListener('storage', onStorageChange)
  window.removeEventListener('app:open-settings', onOpenSettings)
  window.removeEventListener('keydown', onGlobalSearchShortcut)
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
  gap: var(--space-0_5);
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
  top: calc(var(--space-0_5) * -1);
  right: calc(var(--space-0_5) * -1);
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  animation: queue-pulse var(--duration-pulse) ease-out infinite;
}
@keyframes queue-pulse {
  70%,
  100% {
    box-shadow: 0 0 0 6px transparent;
  }
}
.footer-badge {
  position: absolute;
  top: var(--space-0_5);
  right: var(--space-0_5);
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
  transition: width var(--duration-slow) var(--ease-out);
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

/* 标题栏与内容同色，不留色带 */
.top-menu {
  position: relative;
  z-index: var(--z-above);
  flex: 0 0 var(--titlebar-height);
  height: var(--titlebar-height);
  background: var(--bg-content);
  -webkit-app-region: drag;
}
.menu-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 100%;
  padding: 0 var(--space-4) 0 var(--space-3);
}
.toolbar-leading {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  -webkit-app-region: no-drag;
}
.window-section {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  -webkit-app-region: no-drag;
}

.global-search {
  display: flex;
  width: min(320px, 32vw);
  margin-left: var(--space-2);
}
.global-search-field {
  padding: 0 var(--space-1) 0 var(--space-3);
}
.global-search-field :deep(.ui-input-clear) {
  --ib-size: 24px;
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
.app-layout.sidebar-collapsed .sidebar-brand {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}
.app-layout.sidebar-collapsed .brand-name,
.app-layout.sidebar-collapsed .brand-mark,
.app-layout.sidebar-collapsed .sidebar-heading {
  display: none;
}
.app-layout.sidebar-collapsed .sidebar-toggle {
  margin-left: 0;
}
.app-layout.sidebar-collapsed .sidebar-item {
  padding: 0;
}
.app-layout.sidebar-collapsed .sidebar-divider {
  margin-right: var(--space-2);
  margin-left: var(--space-2);
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
.app-layout.is-phone .sidebar-toggle {
  display: none;
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
.app-layout.is-phone .menu-content {
  padding: 0 var(--space-2);
}
.app-layout.is-phone .global-search {
  flex: 1;
  width: auto;
  min-width: 0;
  margin-left: var(--space-1);
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
