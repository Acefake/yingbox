<template>
  <!-- 详情头部 -->
  <div class="flex items-start gap-6 mb-6">
    <div class="flex flex-col items-center">
      <!-- 海报/缩略图 -->
      <div
        class="w-50 bg-gray-800 bg-opacity-50 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden poster-3d-container backdrop-blur-sm"
      >
        <img
          v-if="posterImageDataUrl"
          :src="posterImageDataUrl"
          alt="海报"
          class="w-full object-cover rounded-lg poster-3d-item"
          @error="handleImageError"
        />
        <svg
          v-else
          class="w-16 h-16 text-gray-600"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fill-rule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clip-rule="evenodd"
          ></path>
        </svg>
      </div>
    </div>

    <!-- 基本信息 -->
    <div class="flex-1 min-w-0">
      <h1 class="text-3xl font-bold text-white mb-2 drop-shadow-lg">
        {{ selectedItem.name }}
      </h1>

      <!-- 电影信息 -->
      <div>
        <MovieInfo
          v-if="movieInfo"
          :movie-info="movieInfo"
          :poster-url="posterImageDataUrl"
          :loading="false"
        />
      </div>

      <!-- 演员列表 -->
      <div v-if="actors && actors.length" class="mt-4">
        <p
          class="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2"
        >
          演员
        </p>
        <div class="custom-scrollbar flex gap-3 overflow-x-auto pb-1">
          <div
            v-for="actor in actors"
            :key="actor.name"
            class="flex flex-col items-center flex-shrink-0 w-14"
          >
            <div
              class="w-11 h-11 rounded-full overflow-hidden bg-gray-700/60 ring-1 ring-white/10 flex items-center justify-center"
            >
              <img
                v-if="actor.photoDataUrl"
                :src="actor.photoDataUrl"
                :alt="actor.name"
                class="w-full h-full object-cover"
              />
              <svg
                v-else
                class="w-5 h-5 text-gray-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <span
              class="text-[9px] text-gray-400 mt-1 text-center w-full truncate leading-tight"
              >{{ actor.name }}</span
            >
            <span
              v-if="actor.role"
              class="text-[8px] text-gray-600 text-center w-full truncate leading-tight"
              >{{ actor.role }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 单个视频：大播放按钮 -->
  <div v-if="videoFiles.length === 1" class="mt-4">
    <button
      class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-green-600/20 hover:bg-green-600/30 border border-green-500/20 hover:border-green-500/40 transition-all group"
      @click="$emit('playFile', videoFiles[0].path)"
    >
      <div class="w-10 h-10 rounded-full bg-green-500/30 flex items-center justify-center flex-shrink-0 group-hover:bg-green-500/50 transition-colors">
        <svg class="w-5 h-5 text-green-400 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
        </svg>
      </div>
      <div class="flex-1 min-w-0 text-left">
        <div class="text-sm font-medium text-green-300 group-hover:text-green-200 transition-colors">播放视频</div>
        <div class="text-[11px] text-gray-500 truncate">{{ videoFiles[0].name }}</div>
      </div>
      <span class="text-[11px] text-gray-600 flex-shrink-0">{{ formatSize(videoFiles[0].size) }}</span>
    </button>
  </div>

  <!-- 多个视频：列表 -->
  <div v-else-if="videoFiles.length > 1" class="mt-4">
    <p
      class="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2"
    >
      视频文件 ({{ videoFiles.length }})
    </p>
    <div class="space-y-1">
      <div
        v-for="vf in videoFiles"
        :key="vf.path"
        class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
      >
        <svg
          class="w-4 h-4 text-gray-500 flex-shrink-0"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
          />
        </svg>
        <span class="flex-1 text-xs text-gray-300 truncate" :title="vf.name">
          {{ vf.name }}
        </span>
        <span class="text-[10px] text-gray-600 flex-shrink-0">
          {{ formatSize(vf.size) }}
        </span>
        <button
          class="opacity-0 group-hover:opacity-100 text-green-400 hover:text-green-300 transition-all flex-shrink-0 px-1"
          title="播放"
          @click="$emit('playFile', vf.path)"
        >
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
            />
          </svg>
        </button>
        <button
          class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all flex-shrink-0 px-1"
          title="删除"
          @click="$emit('deleteFile', vf.path)"
        >
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022 1.005 11.998A2.75 2.75 0 007.76 20h4.48a2.75 2.75 0 002.742-2.53l1.005-11.998.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MovieInfo from '@/views/Movie/MovieInfo.vue'
import type { ActorInfo, FileItem } from '@/types'

interface Props {
  selectedItem?: Record<string, any>
  posterImageDataUrl?: string
  movieInfo?: Record<string, any> | null
  fanartImageDataUrl?: string
  actors?: ActorInfo[]
}

const props = withDefaults(defineProps<Props>(), {
  selectedItem: () => ({}),
  posterImageDataUrl: '',
  movieInfo: null,
  fanartImageDataUrl: '',
  actors: () => [],
})

defineEmits<{
  playFile: [path: string]
  deleteFile: [path: string]
}>()

const videoExtensions = /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i

const videoFiles = computed<FileItem[]>(() => {
  const item = props.selectedItem
  if (!item?.files) return []
  return item.files.filter(
    (f: FileItem) => f.isFile && videoExtensions.test(f.name)
  )
})

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement
  if (target) target.style.display = 'none'
}
</script>

<style scoped>
/* 使用全局 custom-scrollbar-light 样式 */
</style>
