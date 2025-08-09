<template>
  <div class="flex gap-3">
    <!-- 刷新按钮 -->
    <div class="flex flex-col items-center">
      <button
        class="p-2 rounded-lg bg-blue-600 bg-opacity-70 hover:bg-opacity-90 disabled:bg-gray-600 disabled:bg-opacity-70 text-white transition-all duration-200 backdrop-blur-sm shadow-lg"
        title="刷新"
        :disabled="dirLoading"
        @click="$emit('refresh')"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          ></path>
        </svg>
      </button>
      <span class="text-xs text-white text-opacity-80 mt-1">刷新</span>
    </div>

    <!-- 添加文件夹按钮 -->
    <div class="flex flex-col items-center">
      <button
        :disabled="dirLoading"
        class="p-2 rounded-lg bg-green-600 bg-opacity-70 hover:bg-opacity-90 disabled:bg-gray-600 disabled:bg-opacity-70 text-white transition-all duration-200 backdrop-blur-sm shadow-lg"
        :title="dirLoading ? '扫描中...' : '添加文件夹'"
        @click="$emit('addFolder')"
      >
        <svg
          v-if="!dirLoading"
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          ></path>
        </svg>
        <svg
          v-else
          class="w-5 h-5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </button>
      <span class="text-xs text-white text-opacity-80 mt-1">添加</span>
    </div>

    <!-- 清除缓存按钮 -->
    <div class="flex flex-col items-center">
      <button
        class="p-2 rounded-lg bg-red-600 bg-opacity-70 hover:bg-opacity-90 text-white transition-all duration-200 backdrop-blur-sm shadow-lg"
        title="清除缓存"
        @click="handleClearCache"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          ></path>
        </svg>
      </button>
      <span class="text-xs text-white text-opacity-80 mt-1">清除</span>
    </div>

    <!-- 队列管理按钮 -->
    <div class="flex flex-col items-center">
      <button
        class="p-2 rounded-lg bg-purple-600 bg-opacity-70 hover:bg-opacity-90 text-white transition-all duration-200 backdrop-blur-sm shadow-lg relative"
        title="刮削队列管理"
        @click="$emit('showQueue')"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          ></path>
        </svg>
        <!-- 队列数量徽章 -->
        <span
          v-if="scrapeQueueCount > 0"
          class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center"
        >
          {{ scrapeQueueCount > 99 ? '99+' : scrapeQueueCount }}
        </span>
        <!-- 处理中指示器 -->
        <div
          v-if="isProcessingQueue"
          class="absolute inset-0 bg-blue-500 bg-opacity-30 rounded-lg animate-pulse"
        ></div>
      </button>
      <span class="text-xs text-white text-opacity-80 mt-1">队列</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  dirLoading: boolean;
  scrapeQueueCount?: number;
  isProcessingQueue?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  refresh: [];
  addFolder: [];
  clearCache: [];
  showQueue: [];
}>();

/**
 * 处理清除缓存按钮点击
 */
const handleClearCache = (): void => {
  emit("clearCache");
};
</script>
