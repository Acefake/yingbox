<template>
  <!-- 应用主布局容器 -->
  <div class="app-layout h-screen w-screen overflow-hidden bg-gray-900">
    <!-- 顶部毛玻璃菜单栏 -->
    <header class="top-menu">
      <div class="menu-content">
        <!-- 左侧 Logo -->
        <div class="logo-section">
          <div class="logo-icon">
            <img :src="logo" alt="logo" />
          </div>
          <span class="logo-text">Scraper</span>
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

        <!-- 右侧：队列 + 窗口控制（含设置） -->
        <div class="settings-section">
          <QueueWidget />
          <WinControls :show-settings="true" @open-settings="openSettings" />
        </div>
      </div>
    </header>

    <!-- 主内容区域 -->
    <main class="main-content">
      <slot />
    </main>

    <!-- 全局设置面板 -->
    <SettingsPanel
      :visible="settingsVisible"
      @close="settingsVisible = false"
    />

    <!-- 默认背景图 -->
    <img
      :src="bgImg"
      class="w-full h-full object-cover opacity-20 transition-opacity duration-300 fixed inset-0"
      alt="背景图片"
    />

    <!-- 全屏背景艺术图 -->
    <div
      v-if="globalBackgroundImage"
      class="fixed inset-0 transition-opacity duration-500"
      :style="{
        backgroundImage: `
          linear-gradient(
            to bottom,
            rgba(0,0,0,0.2) 0%,
            rgba(0,0,0,0.4) 30%,
            rgba(0,0,0,0.7) 70%,
            rgba(17,24,39,0.95) 100%
          ),
          url(${globalBackgroundImage})
        `,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backdropFilter: 'blur(8px)',
      }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import WinControls from '@/components/WinControls.vue'
import logo from '@/assets/imgs/logo.svg'
import bgImg from '@/assets/imgs/home-bg.jpg'
import QueueWidget from '@/components/QueueWidget.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'

const router = useRouter()
const route = useRoute()

const globalBackgroundImage = ref<string>('')
const settingsVisible = ref(false)

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
  gap: 12px;
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
  font-size: 25px;
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

/* 主内容区域 */
.main-content {
  flex: 1;
  margin-top: 80px;
  /* 为顶部菜单留出空间 */
  height: calc(100vh - 80px);
  overflow: hidden;
}
</style>
