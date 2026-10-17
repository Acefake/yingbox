<template>
  <!-- 应用主布局容器 -->
  <div
    class="app-layout h-screen w-screen overflow-hidden"
    :class="{
      'sidebar-collapsed': sidebarCollapsed && !isPhone,
      'is-phone': isPhone,
      'is-web': isWeb,
      'sidebar-open': isPhone && sidebarOpen,
    }"
  >
    <button
      v-if="isPhone && sidebarOpen"
      class="sidebar-backdrop"
      type="button"
      aria-label="关闭菜单"
      @click="sidebarOpen = false"
    />
    <!-- 媒体中心侧栏 -->
    <aside class="app-sidebar" aria-label="媒体中心导航">
      <div class="sidebar-brand">
        <span class="brand-mark" aria-hidden="true"><AppIcon name="movie" /></span>
        <span class="brand-name">{{ appName }}</span>
        <button
          class="sidebar-toggle"
          type="button"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <AppIcon name="panel" />
        </button>
      </div>
      <nav class="sidebar-nav">
        <span class="sidebar-heading">资料库</span>
        <button
          class="sidebar-item"
          :class="{ active: route.name === 'Online' && !route.query.tab }"
          @click="navigateTo('/')"
         title="首页" aria-label="首页">
          <AppIcon name="home" size="lg" /><span>首页</span>
        </button>
        <button
          class="sidebar-item"
          :class="{
            active: route.name === 'Online' && route.query.tab === 'recent',
          }"
          @click="navigateTo('/?tab=recent')"
         title="最近播放" aria-label="最近播放">
          <AppIcon name="history" size="lg" /><span>最近播放</span>
        </button>
        <button
          class="sidebar-item"
          :class="{
            active: route.name === 'Online' && route.query.tab === 'favorites',
          }"
          @click="navigateTo('/?tab=favorites')"
         title="我的收藏" aria-label="我的收藏">
          <AppIcon name="heart" size="lg" /><span>我的收藏</span>
        </button>
        <template v-if="hasLocalLibrary">
          <div class="sidebar-divider" />
          <span class="sidebar-heading">本地媒体</span>
          <button
            class="sidebar-item"
            :class="{ active: route.name === 'Movie' }"
            @click="navigateTo('/movie')"
           title="电影" aria-label="电影">
            <AppIcon name="movie" size="lg" /><span>电影</span>
          </button>
          <button
            class="sidebar-item"
            :class="{ active: route.name === 'TV' }"
            @click="navigateTo('/tv')"
           title="电视剧" aria-label="电视剧">
            <AppIcon name="tv" size="lg" /><span>电视剧</span>
          </button>
        </template>
        <button
          v-if="adultMode && hasLocalLibrary"
          class="sidebar-item"
          :class="{ active: route.name === 'Amane' }"
          @click="navigateTo('/amane')"
         title="Amane" aria-label="Amane">
          <AppIcon name="movie" size="lg" /><span>Amane</span>
        </button>
        <button
          v-if="adultMode"
          class="sidebar-item"
          :class="{ active: route.name === 'AV' }"
          @click="navigateTo('/av')"
         title="AV资源" aria-label="AV资源">
          <AppIcon name="av" size="lg" /><span>AV资源</span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <div class="footer-actions">
          <button
            class="footer-icon-btn"
            data-queue-anchor
            :class="{
              active: queuePanelVisible,
              processing: queueBusy,
            }"
            type="button"
            :title="queueLabel"
            :aria-label="queueLabel"
            :aria-pressed="queuePanelVisible"
            @click="queuePanelVisible = !queuePanelVisible"
          >
            <span class="footer-queue-icon" aria-hidden="true">
              <AppIcon name="list" size="lg" />
              <span v-if="queueBusy" class="footer-pulse" />
            </span>
            <span class="footer-action-label">刮削队列</span>
            <span v-if="activeCount > 0" class="footer-badge">{{
              activeCount
            }}</span>
            <span
              v-if="processingCount > 0"
              class="footer-progress"
              :style="{
                width: Math.max(14, Math.round(progress * 100)) + '%',
              }"
            />
          </button>
          <button
            class="footer-icon-btn settings-entry"
            :class="{ active: settingsVisible }"
            type="button"
            title="设置"
            aria-label="打开设置"
            @click="openGlobalSettings()"
          >
            <AppIcon name="settings" size="lg" /><span class="footer-action-label">设置</span>
          </button>
        </div>
      </div>
    </aside>

    <div class="shell-column">
      <!-- 顶部工具栏，保留窗口拖拽区域 -->
      <header class="top-menu">
        <div class="menu-content">
          <div class="toolbar-leading">
            <button
              v-if="isPhone"
              class="toolbar-btn"
              type="button"
              aria-label="打开菜单"
              @click="sidebarOpen = true"
            >
              <AppIcon name="menu" />
            </button>
            <button
              class="toolbar-btn"
              aria-label="后退"
              title="后退"
              @click="navigateBack"
            >
              <AppIcon name="back" />
            </button>
            <button
              v-if="!isPhone"
              class="toolbar-btn"
              aria-label="前进"
              title="前进"
              @click="router.forward()"
            >
              <AppIcon name="forward" />
            </button>
            <button
              v-if="!isPhone"
              class="toolbar-btn"
              aria-label="刷新"
              title="刷新"
              @click="router.go(0)"
            >
              <AppIcon name="refresh" />
            </button>
            <div
              class="global-search"
              role="search"
              :aria-label="globalSearchPlaceholder"
            >
              <AppIcon name="search" size="md" />
              <input
                ref="globalSearchInput"
                v-model="globalSearch"
                :placeholder="globalSearchPlaceholder"
                type="text"
                @keydown.enter.prevent="submitGlobalSearch"
              />
              <button
                v-if="globalSearch"
                class="global-search-clear"
                type="button"
                aria-label="清空搜索"
                @click="clearGlobalSearch"
              >
                <AppIcon name="close" size="sm" />
              </button>
            </div>
          </div>

          <!-- 右侧：窗口控制 -->
          <div class="settings-section">
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

    <nav v-if="isPhone" class="bottom-nav" aria-label="主导航">
      <button
        type="button"
        :class="{ active: route.name === 'Online' && !route.query.tab }"
        @click="navigateTo('/')"
      >
        <AppIcon name="home" size="lg" /><span>首页</span>
      </button>
      <button
        type="button"
        :class="{
          active: route.name === 'Online' && route.query.tab === 'favorites',
        }"
        @click="navigateTo('/?tab=favorites')"
      >
        <AppIcon name="heart" size="lg" /><span>收藏</span>
      </button>
      <button
        v-if="hasLocalLibrary"
        type="button"
        :class="{ active: route.name === 'Movie' }"
        @click="navigateTo('/movie')"
      >
        <AppIcon name="movie" size="lg" /><span>电影</span>
      </button>
      <button
        type="button"
        :class="{ active: sidebarOpen }"
        @click="sidebarOpen = true"
      >
        <AppIcon name="menu" /><span>菜单</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WinControls from '@/components/WinControls.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import ScrapeQueuePanel from '@/components/ScrapeQueuePanel.vue'
import AppIcon from '@/components/AppIcon.vue'
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
const globalSearchInput = ref<HTMLInputElement | null>(null)
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

// 监听自定义事件（同页面内切换）和跨 Tab storage 事件
const handleAdultModeChange = (enabled: boolean) => {
  adultMode.value = enabled
  if (!enabled && ['/av', '/amane'].includes(route.path)) {
    router.push('/')
  }
}
const toggleAdultMode = () => {
  const enabled = !adultMode.value
  localStorage.setItem('adultMode', enabled ? '1' : '0')
  window.dispatchEvent(new CustomEvent('adultModeChange', { detail: enabled }))
}
const onAdultModeChange = (e: Event) => {
  handleAdultModeChange((e as CustomEvent<boolean>).detail)
}
const onStorageChange = (e: StorageEvent) => {
  if (e.key === 'adultMode') handleAdultModeChange(e.newValue === '1')
}
const onGlobalSearchShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    globalSearchInput.value?.focus()
  }
}
const onSettingsShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openGlobalSettings()
  }
}
const openGlobalSettings = (section = 'appearance') => {
  settingsInitialSection.value = section
  settingsVisible.value = true
}
const onOpenSettings = (event: Event) => {
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
})
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  position: relative;
  background: var(--bg-main);
  color: var(--text-main);
}

.app-layout.is-web .app-sidebar,
.app-layout.is-web .top-menu {
  -webkit-app-region: no-drag;
}

/* Sidebar — document flow on desktop (never covers content) */
.app-sidebar {
  position: relative;
  inset: auto;
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--sidebar-width);
  width: var(--sidebar-width);
  max-width: var(--sidebar-width);
  height: 100%;
  min-height: 0;
  padding: 12px 10px;
  z-index: 2;
  color: var(--text-secondary);
  background: var(--bg-sidebar-solid);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-right: 1px solid var(--border-subtle);
  -webkit-app-region: no-drag;
  transition: width 150ms ease, flex-basis 150ms ease, max-width 150ms ease, transform 180ms ease;
}

.shell-column {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  padding: 4px 10px 22px;
  color: var(--text-primary);
}

.brand-mark {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: none;
  flex: 0 0 auto;

  color: var(--text-primary);

  display: grid;

  place-items: center;
}

.brand-name {
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.sidebar-toggle {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: var(--transition-fast);
}

.sidebar-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-footer {
  flex: 0 0 auto;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--separator);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 14px;
  font-weight: var(--font-weight-regular);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s var(--ease-out),
    color 0.16s var(--ease-out);
}

.sidebar-item :deep(.app-icon) {
  width: var(--icon-lg);
  height: var(--icon-lg);
  flex: 0 0 var(--icon-lg);
}

.toolbar-btn :deep(.app-icon),
.bottom-nav :deep(.app-icon) {
  display: block;
  margin: 0 auto;
}

.bottom-nav :deep(.app-icon) {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.sidebar-item:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.sidebar-item.active {
  color: var(--text-primary);
  background: var(--selection-bg);
  font-weight: var(--font-weight-medium);
}

.sidebar-divider {
  height: 1px;
  margin: 12px 12px 2px;
  background: var(--border-subtle);
}

.sidebar-heading {
  padding: 16px 12px 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

/* Titlebar in shell column — 与内容同色，不留色带 */
.top-menu {
  position: relative;
  top: auto;
  left: auto;
  right: auto;
  flex: 0 0 var(--titlebar-height);
  height: var(--titlebar-height);
  z-index: 5;
  background: var(--bg-content);
  -webkit-app-region: drag;
}

.menu-content {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 0 14px;
  max-width: 100%;
  gap: 12px;
}

.toolbar-leading {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.toolbar-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: var(--transition-fast);
}

.toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.global-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 32vw);
  height: 32px;
  margin-left: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  color: var(--text-tertiary);
  background: var(--bg-fill-tertiary);
  transition: var(--transition-fast);
}

@media (prefers-reduced-transparency: reduce) {
  .global-search {
    background: var(--bg-elevated);
  }
}

.global-search:focus-within {
  color: var(--text-secondary);
  background: var(--bg-elevated);
  box-shadow: var(--focus-ring);
}

.global-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none !important;
  box-shadow: none !important;
  color: var(--text-primary);
  background: transparent;
  font-size: var(--text-sm);
  appearance: none;
  -webkit-appearance: none;
}

/* 去掉系统自带清空钮，只保留自定义 × */
.global-search input::-webkit-search-cancel-button,
.global-search input::-webkit-search-decoration,
.global-search input::-webkit-search-results-button,
.global-search input::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
  display: none;
}

.global-search input::placeholder {
  color: var(--text-tertiary);
}

.global-search :deep(.app-icon) {
  flex: 0 0 auto;
  stroke-width: 2;
}

.global-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--text-tertiary);
  background: transparent;
  line-height: 0;
  cursor: pointer;
}

.global-search-clear :deep(.app-icon) {
  width: 12px;
  height: 12px;
  stroke-width: 2.25;
}

.global-search-clear:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.settings-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  -webkit-app-region: no-drag;
}

.footer-actions {
  display: flex;
  align-items: stretch;
  gap: 2px;

  flex-direction: column;
}

.footer-icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  height: 36px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: var(--transition-fast);

  padding: 0 12px;

  gap: 10px;

  font-size: 13px;
}

.footer-icon-btn:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.footer-icon-btn.active {
  color: var(--accent);
  background: var(--bg-active-soft);
}

.footer-icon-btn :deep(.app-icon) {
  display: block;
}

.footer-queue-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.footer-pulse {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  animation: queue-pulse 1.4s ease-out infinite;
}
@keyframes queue-pulse {
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.footer-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  line-height: 15px;
  text-align: center;
  pointer-events: none;
}

.footer-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  opacity: 0.85;
  transition: width 0.35s var(--ease-out);
}

/* Main content fills shell column */
.main-content {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  height: auto;
  overflow: hidden;
}

.content-surface {
  height: 100%;
  background: var(--bg-main);
  overflow: hidden;
}

/* Collapsed sidebar */
.app-layout.sidebar-collapsed .app-sidebar {
  flex-basis: var(--sidebar-width-collapsed);
  width: var(--sidebar-width-collapsed);
  max-width: var(--sidebar-width-collapsed);
  padding-left: 10px;
  padding-right: 10px;
}
.app-layout.sidebar-collapsed .sidebar-brand {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}
.app-layout.sidebar-collapsed .brand-name,
.app-layout.sidebar-collapsed .brand-mark {
  display: none;
}
.app-layout.sidebar-collapsed .sidebar-item {
  justify-content: center;
  padding: 0;
}
.app-layout.sidebar-collapsed .sidebar-item span {
  display: none;
}
.app-layout.sidebar-collapsed .sidebar-heading {
  display: none;
}
.app-layout.sidebar-collapsed .sidebar-divider {
  margin-left: 8px;
  margin-right: 8px;
}

/* 收起侧栏：页脚按钮纵向堆叠 */
.app-layout.sidebar-collapsed .footer-actions {
  flex-direction: column;
  gap: 2px;
}

.app-layout.sidebar-collapsed .footer-action-label { display: none; }
.app-layout.sidebar-collapsed .footer-icon-btn { width: 36px; padding: 0; justify-content: center; }

/* Phone / narrow: drawer sidebar overlays only when open */
.app-layout.is-phone,
.app-layout.is-phone.sidebar-collapsed {
  flex-direction: column;
}

.app-layout.is-phone .app-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  flex: none;
  width: min(320px, 86vw);
  max-width: min(320px, 86vw);
  height: 100%;
  padding: calc(18px + var(--safe-top)) 12px calc(20px + var(--safe-bottom));
  transform: translateX(-110%);
  z-index: 1150;
  box-shadow: var(--shadow-lg);
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
  height: 100%;
  padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom));
}

.app-layout.is-phone .top-menu {
  flex-basis: calc(var(--titlebar-height) + var(--safe-top));
  height: calc(var(--titlebar-height) + var(--safe-top));
  padding-top: var(--safe-top);
  -webkit-app-region: no-drag;
}

.app-layout.is-phone .main-content {
  margin: 0;
  height: auto;
}

.app-layout.is-phone .sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1140;
  border: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(6px);
}

.app-layout.is-phone .bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  display: flex;
  align-items: stretch;
  height: calc(var(--bottom-nav-height) + var(--safe-bottom));
  padding: 0 8px var(--safe-bottom);
  background: var(--bg-titlebar);
  backdrop-filter: blur(var(--blur-titlebar)) saturate(var(--saturate-vibrancy));
  -webkit-backdrop-filter: blur(var(--blur-titlebar))
    saturate(var(--saturate-vibrancy));
  border-top: 1px solid var(--separator);
}

.app-layout.is-phone .bottom-nav button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--bottom-nav-height);
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
}

.app-layout.is-phone .bottom-nav button.active {
  color: var(--accent-text);
}

.app-layout.is-phone .global-search {
  flex: 1;
  width: auto;
  min-width: 0;
  margin-left: 4px;
}

.app-layout.is-phone .menu-content {
  padding: 0 10px;
}

@media (max-width: 768px) {
  /* Fallback before/without is-phone class */
  .app-layout:not(.is-phone) {
    flex-direction: column;
  }
  .app-layout:not(.is-phone) .app-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    flex: none;
    width: min(320px, 86vw);
    max-width: min(320px, 86vw);
    height: 100%;
    transform: translateX(-110%);
    z-index: 1150;
    pointer-events: none;
  }
  .app-layout:not(.is-phone).sidebar-open .app-sidebar,
  .app-layout:not(.is-phone) .app-sidebar {
    /* stay closed unless JS opens; without is-phone, sidebar-open won't set — keep hidden */
  }
  .app-layout:not(.is-phone) .shell-column {
    width: 100%;
    padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom));
  }
  .app-layout:not(.is-phone) .top-menu {
    left: auto;
    height: calc(var(--titlebar-height) + var(--safe-top));
    padding-top: var(--safe-top);
  }
  .app-layout:not(.is-phone) .main-content {
    margin: 0;
  }
}
</style>
