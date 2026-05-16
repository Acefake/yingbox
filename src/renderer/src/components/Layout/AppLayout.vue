<template>
  <!-- 应用主布局容器 -->
  <div class="app-layout h-screen w-screen overflow-hidden">
    <!-- 顶部毛玻璃菜单栏 -->
    <header class="top-menu">
      <div class="menu-content">
        <!-- 左侧 Logo -->
        <div class="logo-section">
          <div class="logo-icon">
            <img :src="logo" alt="logo" />
          </div>
          <span class="logo-text">{{ appName }}</span>
        </div>

        <!-- 中间导航 -->
        <div class="navigation-section">
          <nav class="nav-tabs">
            <button
              class="nav-tab"
              :class="{ active: route.name === 'Online' }"
              @click="navigateTo('/')"
            >
              在线观看
            </button>

            <!-- AV资源 - 成人模式显示 -->
            <button
              v-if="adultMode"
              class="nav-tab"
              :class="{ active: route.name === 'AV' }"
              @click="navigateTo('/av')"
            >
              AV资源
            </button>

            <!-- 刮削服务下拉 -->
            <div
              class="nav-dropdown"
              @mouseenter="openScraper"
              @mouseleave="scheduleScraper"
            >
              <button
                class="nav-tab"
                :class="{
                  active: route.name === 'Movie' || route.name === 'TV',
                }"
              >
                刮削服务
                <svg
                  viewBox="0 0 10 6"
                  width="10"
                  height="6"
                  style="margin-left: 4px; opacity: 0.6"
                >
                  <path d="M0 0l5 6 5-6z" fill="currentColor" />
                </svg>
              </button>
              <Transition name="dropdown-fade">
                <div
                  v-if="scraperOpen"
                  class="dropdown-menu"
                  @mouseenter="openScraper"
                  @mouseleave="scheduleScraper"
                >
                  <button
                    class="dropdown-item"
                    :class="{ active: route.name === 'Movie' }"
                    @click="navigateTo('/movie')"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                    电影
                  </button>
                  <button
                    class="dropdown-item"
                    :class="{ active: route.name === 'TV' }"
                    @click="navigateTo('/tv')"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="2" y="7" width="20" height="14" rx="2" />
                      <path d="M16 3l-4 4-4-4" />
                    </svg>
                    电视剧
                  </button>
                </div>
              </Transition>
            </div>
          </nav>
        </div>

        <!-- 右侧：队列 + 数据源 + 窗口控制（含设置） -->
        <div class="settings-section">
          <QueueWidget />
          <button class="source-mgr-btn" :class="{ active: sourcePanelVisible }" title="数据源管理" @click="sourcePanelVisible = !sourcePanelVisible">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
            </svg>
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

    <!-- 统一背景层 -->
    <div
      class="fixed inset-0 transition-all duration-500"
      :style="{
        zIndex: 0,
        backgroundImage: globalBackgroundImage
          ? `linear-gradient(to bottom, rgba(30, 30, 30, 0.7) 0%, rgba(30, 30, 30, 0.85) 100%), url(${globalBackgroundImage})`
          : `linear-gradient(to bottom, rgba(30, 30, 30, 0.85) 0%, rgba(30, 30, 30, 0.95) 100%), url(${bgImg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        filter: 'blur(12px) scale(1.1)',
      }"
    ></div>
    <!-- 额外模糊遮罩层 -->
    <div
      class="fixed inset-0 pointer-events-none"
      style="z-index: 1; background: rgba(30, 30, 30, 0.25); backdrop-filter: blur(8px);"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { provide, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import WinControls from '@/components/WinControls.vue'
import logo from '@/assets/imgs/logo.svg'
import bgImg from '@/assets/imgs/home-bg.jpg'
import QueueWidget from '@/components/QueueWidget.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SourceManagerPanel from '@/components/SourceManagerPanel.vue'

const router = useRouter()
const route = useRoute()

// 从 package.json 获取应用名称
const appName = ref('影盒')

const globalBackgroundImage = ref<string>('')
const settingsVisible = ref(false)
const sourcePanelVisible = ref(false)

const globalMenuBackgroundColor = ref<string>('')

/**
 * 设置全局背景图片和菜单背景色
 * @param backgroundImage - 背景图片URL
 * @param menuBackgroundColor - 菜单背景色
 */
const setGlobalBackground = (
  backgroundImage: string,
  menuBackgroundColor: string
): void => {
  globalBackgroundImage.value = backgroundImage
  globalMenuBackgroundColor.value = menuBackgroundColor
}

/**
 * 清除全局背景
 */
const clearGlobalBackground = (): void => {
  globalBackgroundImage.value = ''
  globalMenuBackgroundColor.value = ''
}

// 向子组件提供背景控制方法
provide('appLayoutMethods', {
  setGlobalBackground,
  clearGlobalBackground,
})

// 监听路由变化，切换到在线观看或AV资源时清除背景
watch(
  () => route.name,
  (newRouteName) => {
    if (newRouteName === 'Online' || newRouteName === 'AV') {
      clearGlobalBackground()
    }
  }
)

/**
 * 导航到指定路由
 * @param path - 目标路由路径
 */
const navigateTo = (path: string): void => {
  router.push(path)
}

/**
 * 设置按钮点击处理
 */
const openSettings = (): void => {
  settingsVisible.value = true
}

// 成人模式检测
const adultMode = ref(localStorage.getItem('adultMode') === '1')

// 监听自定义事件（同页面内切换）和跨 Tab storage 事件
const handleAdultModeChange = (enabled: boolean) => {
  adultMode.value = enabled
  if (!enabled && route.path === '/av') {
    router.push('/online')
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('adultModeChange', (e) => {
    handleAdultModeChange((e as CustomEvent<boolean>).detail)
  })
  window.addEventListener('storage', (e) => {
    if (e.key === 'adultMode') {
      handleAdultModeChange(e.newValue === '1')
    }
  })
}

const scraperOpen = ref(false)
let scraperTimer: ReturnType<typeof setTimeout> | null = null

const openScraper = () => {
  if (scraperTimer) {
    clearTimeout(scraperTimer)
    scraperTimer = null
  }
  scraperOpen.value = true
}
const scheduleScraper = () => {
  scraperTimer = setTimeout(() => {
    scraperOpen.value = false
  }, 120)
}
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  position: relative;
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

/* Logo 区域 */
.logo-section {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.logo-text {
  font-size: 20px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.025em;
}

/* 导航区域 */
.navigation-section {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
}

.nav-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 100px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.nav-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 18px;
  background: transparent;
  border: none;
  border-radius: 100px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
}

.nav-tab.active {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.nav-tab.active:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* 刃削下拉菜单 */
.nav-dropdown {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 12, 20, 0.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 4px;
  min-width: 120px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  z-index: 200;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.dropdown-item.active {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-weight: 500;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
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
  height: 32px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
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
</style>
