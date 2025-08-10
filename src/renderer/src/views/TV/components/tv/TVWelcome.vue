<template>
  <div class="tv-welcome">
    <div class="welcome-container">
      <div class="welcome-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3ZM21 19H3V5H21V19ZM16 10.5L11 7.27V13.73L16 10.5Z" fill="currentColor"/>
        </svg>
      </div>
      <h2 class="welcome-title">欢迎使用电视剧海报刮削器</h2>
      <p class="welcome-description">
        选择左侧的电视剧文件夹开始管理您的电视剧收藏
      </p>
      <div class="welcome-features">
        <div class="feature-item">
          <span class="feature-icon">📺</span>
          <span class="feature-text">自动识别剧集信息</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🖼️</span>
          <span class="feature-text">下载剧集海报</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">📝</span>
          <span class="feature-text">生成季集元数据</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🎭</span>
          <span class="feature-text">管理多季内容</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TVWelcome 组件
 * 
 * 用于显示电视剧模块的欢迎界面，当用户未选择任何电视剧文件时显示
 * 提供友好的引导信息和功能介绍，突出电视剧管理的特色功能
 */
</script>

<style scoped>
.tv-welcome {
  @apply flex items-center justify-center h-full min-h-96;
}

.welcome-container {
  @apply text-center max-w-md mx-auto px-6;
}

.welcome-icon {
  @apply text-blue-400 mb-6 flex justify-center;
}

.welcome-title {
  @apply text-2xl font-bold text-gray-800 dark:text-gray-200 mb-4;
}

.welcome-description {
  @apply text-gray-600 dark:text-gray-400 mb-8 leading-relaxed;
}

.welcome-features {
  @apply space-y-4;
}

.feature-item {
  @apply flex items-center justify-center space-x-3 text-gray-700 dark:text-gray-300;
}

.feature-icon {
  @apply text-xl;
}

.feature-text {
  @apply text-sm font-medium;
}
</style>