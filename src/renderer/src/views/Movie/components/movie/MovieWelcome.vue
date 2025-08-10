<template>
  <div class="movie-welcome">
    <div class="welcome-container">
      <div class="welcome-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 4L20 8H17L15 4H13L15 8H12L10 4H8L10 8H7L5 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4H18Z" fill="currentColor"/>
        </svg>
      </div>
      <h2 class="welcome-title">欢迎使用电影海报刮削器</h2>
      <p class="welcome-description">
        选择左侧的电影文件夹开始管理您的电影收藏
      </p>
      <div class="welcome-features">
        <div class="feature-item">
          <span class="feature-icon">🎬</span>
          <span class="feature-text">自动识别电影信息</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🖼️</span>
          <span class="feature-text">下载高质量海报</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">📝</span>
          <span class="feature-text">生成NFO元数据</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MovieWelcome 组件
 * 
 * 用于显示电影模块的欢迎界面，当用户未选择任何电影文件时显示
 * 提供友好的引导信息和功能介绍
 */
</script>

<style scoped>
.movie-welcome {
  @apply flex items-center justify-center h-full min-h-96;
}

.welcome-container {
  @apply text-center max-w-md mx-auto px-6;
}

.welcome-icon {
  @apply text-gray-400 mb-6 flex justify-center;
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