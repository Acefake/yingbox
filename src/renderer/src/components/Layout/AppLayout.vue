<template>
  <!-- 应用主布局容器 -->
  <div class="app-layout h-screen w-screen overflow-hidden" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <!-- 媒体中心侧栏 -->
    <aside class="app-sidebar" aria-label="媒体中心导航">
      <div class="sidebar-brand">
        <span>{{ appName }}</span>
        <button class="sidebar-toggle" type="button" :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="sidebarCollapsed = !sidebarCollapsed">{{ sidebarCollapsed ? '›' : '‹' }}</button>
      </div>
      <nav class="sidebar-nav">
        <button class="sidebar-item" :class="{ active: route.name === 'Online' && !route.query.tab }" @click="navigateTo('/')">
          <AppIcon name="home" /><span>首页</span>
        </button>
        <button class="sidebar-item" :class="{ active: route.name === 'Online' && route.query.tab === 'recent' }" @click="navigateTo('/?tab=recent')">
          <AppIcon name="history" /><span>最近播放</span>
        </button>
        <button class="sidebar-item" :class="{ active: route.name === 'Online' && route.query.tab === 'favorites' }" @click="navigateTo('/?tab=favorites')">
          <AppIcon name="heart" /><span>我的收藏</span>
        </button>
        <div class="sidebar-divider" />
        <span class="sidebar-heading">分类</span>
        <button class="sidebar-item" :class="{ active: route.name === 'Movie' }" @click="navigateTo('/movie')">
          <AppIcon name="movie" /><span>电影</span>
        </button>
        <button class="sidebar-item" :class="{ active: route.name === 'TV' }" @click="navigateTo('/tv')">
          <AppIcon name="tv" /><span>电视剧</span>
        </button>
        <button v-if="adultMode" class="sidebar-item" :class="{ active: route.name === 'AV' }" @click="navigateTo('/av')">
          <AppIcon name="av" /><span>AV资源</span>
        </button>
      </nav>
    </aside>
    <!-- 顶部毛玻璃菜单栏 -->
    <header class="top-menu">
      <div class="menu-content">
        <div class="toolbar-leading">
          <button class="toolbar-btn" aria-label="后退" title="后退" @click="navigateBack"><AppIcon name="back" /></button>
          <button class="toolbar-btn" aria-label="前进" title="前进" @click="router.forward()"><AppIcon name="forward" /></button>
          <button class="toolbar-btn" aria-label="刷新" title="刷新" @click="router.go(0)"><AppIcon name="refresh" /></button>
          <label class="global-search">
            <AppIcon name="search" size="sm" />
            <input v-model="globalSearch" placeholder="搜索（Ctrl + K）" @keydown.enter="submitGlobalSearch" />
          </label>
        </div>

        <!-- 右侧：数据源 + 窗口控制（含设置） -->
        <div class="settings-section">
          <button class="source-mgr-btn" :class="{ active: sourcePanelVisible }" title="数据源管理" aria-label="打开数据源管理" :aria-pressed="sourcePanelVisible" @click="sourcePanelVisible = !sourcePanelVisible">
            <AppIcon name="database" />
            数据源
          </button>
          <WinControls :show-settings="true" @open-settings="openSettings" />
        </div>
      </div>
    </header>

    <!-- 主内容区域 -->
    <main class="main-content" style="position: relative; z-index: 10">
      <slot />
    </main>

    <!-- 全局设置面板 -->
    <SettingsPanel
      :visible="settingsVisible"
      @close="settingsVisible = false"
    />

    <!-- 数据源管理面板 -->
    <SourceManagerPanel
      :visible="sourcePanelVisible"
      @close="sourcePanelVisible = false"
    />

  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import WinControls from '@/components/WinControls.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SourceManagerPanel from '@/components/SourceManagerPanel.vue'
import AppIcon from '@/components/AppIcon.vue'

const router = useRouter()
const route = useRoute()

// 从 package.json 获取应用名称
const appName = ref('影盒')
const sidebarCollapsed = ref(false)

const settingsVisible = ref(false)
const sourcePanelVisible = ref(false)
const globalSearch = ref('')

/**
 * 导航到指定路由
 * @param path - 目标路由路径
 */
const navigateTo = (path: string): void => {
  router.push(path)
}

const navigateBack = (): void => {
  const event = new CustomEvent('app:navigate-back', { cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) router.back()
}

/**
 * 设置按钮点击处理
 */
const openSettings = (): void => {
  settingsVisible.value = true
}

const submitGlobalSearch = (): void => {
  const query = globalSearch.value.trim()
  const targetPath = route.name === 'AV' ? '/av' : '/'
  router.replace({ path: targetPath, query: query ? { tab: 'search', q: query } : { tab: 'search' } })
}

// 成人模式检测
const adultMode = ref(localStorage.getItem('adultMode') === '1')

// 监听自定义事件（同页面内切换）和跨 Tab storage 事件
const handleAdultModeChange = (enabled: boolean) => {
  adultMode.value = enabled
  if (!enabled && route.path === '/av') {
    router.push('/')
  }
}
const onAdultModeChange = (e: Event) => {
  handleAdultModeChange((e as CustomEvent<boolean>).detail)
}
const onStorageChange = (e: StorageEvent) => {
  if (e.key === 'adultMode') handleAdultModeChange(e.newValue === '1')
}
if (typeof window !== 'undefined') {
  window.addEventListener('adultModeChange', onAdultModeChange)
  window.addEventListener('storage', onStorageChange)
}

onUnmounted(() => {
  window.removeEventListener('adultModeChange', onAdultModeChange)
  window.removeEventListener('storage', onStorageChange)
})

</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  position: relative;
  background: #15181d;
}

/* 顶部毛玻璃菜单栏 - 与左侧面板保持一致的样式 */
.top-menu {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 80px;
  z-index: 1000;
  -webkit-app-region: drag;
}

.menu-content {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  max-width: 100%;
}

/* 设置区域 */
.settings-section {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.source-mgr-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-app-region: no-drag;
}
.source-mgr-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}
.source-mgr-btn.active {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.5);
  color: #a5b4fc;
}

/* 主内容区域 */
.main-content {
  flex: 1;
  margin-top: 80px;
  /* 为顶部菜单留出空间 */
  height: calc(100vh - 80px);
  overflow: hidden;
}
.source-mgr-btn svg { width:16px; height:16px; flex:0 0 16px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }

/* Screenshot-inspired media shell */
.app-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 220px;
  padding: 22px 14px;
  z-index: 1100;
  color: rgba(255, 255, 255, .76);
  background: #15181d;
  border-right: 1px solid rgba(255,255,255,.07);
  -webkit-app-region: no-drag;
}
.sidebar-brand { display:flex; align-items:center; gap:10px; padding:0 10px 28px; color:#f5f7f8; font-size:18px; font-weight:650; }
.sidebar-toggle { margin-left:auto; width:28px; height:28px; border:0; border-radius:7px; color:rgba(255,255,255,.55); background:transparent; font-size:22px; line-height:1; cursor:pointer; }
.sidebar-toggle:hover { color:#fff; background:rgba(255,255,255,.1); }
.sidebar-nav { display:flex; flex-direction:column; gap:5px; }
.sidebar-item { display:flex; align-items:center; gap:12px; width:100%; min-height:42px; padding:0 12px; border:0; border-radius:10px; color:rgba(255,255,255,.68); background:transparent; font-size:14px; text-align:left; cursor:pointer; transition:background .18s ease, color .18s ease; }
.sidebar-item:hover, .sidebar-item.active { color:#fff; background:rgba(255,255,255,.14); }
.sidebar-divider { height:1px; margin:18px 10px 14px; background:rgba(255,255,255,.1); }
.sidebar-heading { padding:0 12px 6px; color:rgba(255,255,255,.42); font-size:12px; letter-spacing:.08em; }
.top-menu { left:220px; }
.toolbar-leading { display:flex; align-items:center; gap:8px; -webkit-app-region:no-drag; }
.toolbar-btn { display:grid; place-items:center; width:32px; height:32px; border:0; border-radius:8px; color:rgba(255,255,255,.7); background:transparent; font-size:16px; line-height:1; cursor:pointer; }
.toolbar-btn svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.toolbar-btn:hover { color:#fff; background:rgba(255,255,255,.1); }
.global-search { display:flex; align-items:center; gap:8px; width:min(320px,34vw); height:38px; margin-left:8px; padding:0 13px; border:1px solid rgba(255,255,255,.1); border-radius:10px; color:rgba(255,255,255,.5); background:rgba(255,255,255,.1); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
.global-search input { width:100%; border:0; outline:0; color:#fff; background:transparent; font-size:13px; }
.global-search input::placeholder { color:rgba(255,255,255,.42); }
.global-search .search-icon { width:16px; height:16px; flex:0 0 16px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
.main-content { margin-left:220px; }
.app-layout.sidebar-collapsed .app-sidebar { width:68px; padding-left:10px; padding-right:10px; }
.app-layout.sidebar-collapsed .top-menu { left:68px; }
.app-layout.sidebar-collapsed .main-content { margin-left:68px; }
.app-layout.sidebar-collapsed .sidebar-brand { justify-content:center; padding-left:0; padding-right:0; }
.app-layout.sidebar-collapsed .sidebar-brand > span { display:none; }
.app-layout.sidebar-collapsed .sidebar-item { justify-content:center; padding:0; }
.app-layout.sidebar-collapsed .sidebar-item span { display:none; }
.app-layout.sidebar-collapsed .sidebar-heading { display:none; }
.app-layout.sidebar-collapsed .sidebar-divider { margin-left:8px; margin-right:8px; }

@media (max-width: 860px) {
  .app-sidebar { width:180px; padding:18px 10px; }
  .top-menu { left:180px; }
  .main-content { margin-left:180px; }
  .menu-content { padding:0 12px; }
  .source-mgr-btn { display:none; }
  .global-search { width:min(250px, 42vw); }
}
</style>
