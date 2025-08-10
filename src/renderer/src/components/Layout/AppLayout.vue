<template>
  <!-- 应用主布局容器 -->
  <div class="app-layout h-screen w-screen overflow-hidden bg-gray-900">
    <!-- 默认背景图 -->
    <img
      :src="bgImg"
      class="w-full h-full object-cover opacity-50 transition-opacity duration-300 fixed inset-0 z-0"
      alt="背景图片"
    />

    <!-- 全屏背景艺术图 -->
    <div
      v-if="globalBackgroundImage"
      class="fixed inset-0 z-0 transition-opacity duration-500"
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

    <!-- 顶部毛玻璃菜单栏 -->
    <header class="top-menu">
      <div class="menu-content">
        <!-- 左侧 Logo -->
        <div class="logo-section">
          <div class="logo-icon">
            <img :src="logo" alt="logo" />
          </div>
          <span class="logo-text">PosterScraper</span>
        </div>

        <!-- 中间导航 -->
        <div class="navigation-section">
          <nav class="nav-tabs">
            <button 
              class="nav-tab" 
              :class="{ active: route.name === 'Movie' }"
              @click="navigateTo('/')"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v2a1 1 0 01-1 1h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8H3a1 1 0 01-1-1V5a1 1 0 011-1h4zM9 3v1h6V3H9zm-2 5v11h10V8H7z"/>
              </svg>
              <span>电影</span>
            </button>
            <button 
              class="nav-tab" 
              :class="{ active: route.name === 'TV' }"
              @click="navigateTo('/tv')"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              <span>电视剧</span>
            </button>
          </nav>
        </div>

        <!-- 右侧设置 -->
        <div class="settings-section">
          <button class="settings-btn" @click="openSettings">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- 主内容区域 -->
    <main class="main-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import logo from '@assets/imgs/logo.svg'
import bgImg from '@assets/imgs/home-bg.jpg'

const router = useRouter()
const route = useRoute()

const globalBackgroundImage = ref<string>('')

const globalMenuBackgroundColor = ref<string>('')

/**
 * 设置全局背景图片和菜单背景色
 * @param backgroundImage - 背景图片URL
 * @param menuBackgroundColor - 菜单背景色
 */
const setGlobalBackground = (backgroundImage: string, menuBackgroundColor: string): void => {
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
  console.log('打开设置面板')
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
}

.nav-tabs {
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
  justify-content: center;
}

.nav-tab:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  transform: translateY(-1px);
}

.nav-tab.active {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.nav-tab.active:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* 设置区域 */
.settings-section {
  display: flex;
  align-items: center;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.8);
  transition: all 0.2s ease;
  cursor: pointer;
}

.settings-btn:hover {
  transform: translateY(-1px);
}

.settings-btn:active {
  transform: translateY(0);
}

/* 主内容区域 */
.main-content {
  flex: 1;
  margin-top: 60px; /* 为顶部菜单留出空间 */
  height: calc(100vh - 60px);
  overflow: hidden;
}
</style>
