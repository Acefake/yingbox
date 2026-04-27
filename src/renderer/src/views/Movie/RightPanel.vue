<template>
  <!-- 详情头部 -->
  <div class="flex items-start gap-6 mb-6">
    <div class="flex flex-col items-center">
      <!-- 海报/缩略图 -->
      <div
        class="w-50 bg-gray-800 bg-opacity-50 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden poster-3d backdrop-blur-sm"
      >
        <img
          v-if="posterImageDataUrl"
          :src="posterImageDataUrl"
          alt="海报"
          class="w-full object-cover rounded-lg transition-transform duration-300"
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

      <!-- 横幅图容器 -->
      <!-- <div class="mt-10 w-48 flex items-center justify-center">
        <img
          v-if="fanartImageDataUrl"
          :src="fanartImageDataUrl"
          alt="横幅图"
          class="w-full rounded-lg"
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
      </div> -->
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
        <div class="actor-scroll flex gap-3 overflow-x-auto pb-1">
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
</template>

<script setup lang="ts">
import MovieInfo from '@/views/movie/MovieInfo.vue'
import type { ActorInfo } from '@/types'

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

const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement

  if (target) target.style.display = 'none'
}
</script>

<style scoped>
.actor-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}
.actor-scroll::-webkit-scrollbar {
  height: 3px;
}
.actor-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.actor-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}
</style>
