<template>
  <div class="flex items-center justify-center h-full text-gray-300">
    <div class="flex flex-col items-center">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
        stroke-width="2" stroke="currentColor" class="size-20">
        <path stroke-linecap="round" stroke-linejoin="round" :d="iconPath" />
      </svg>
      <p class="text-2xl mb-2">{{ title }}</p>
      <p class="text-sm">{{ subtitle }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  iconPath?: string
}>(), {
  title: '欢迎使用本项目',
  subtitle: '请先添加文件夹，点击[+添加]按钮添加文件夹',
  iconPath: 'm15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z',
})
</script>
