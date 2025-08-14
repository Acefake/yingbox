<template>
        <!-- 详情头部 -->
        <div class="flex items-start gap-6 mb-6">
         <div class="flex flex-col items-center">
          <!-- 海报/缩略图 -->
          <div
            class="w-48 h-72 bg-gray-800 bg-opacity-50 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden poster-3d backdrop-blur-sm"
          >
            <img
              v-if="posterImageDataUrl"
              :src="posterImageDataUrl"
              alt="海报"
              class="w-full object-cover rounded-lg transition-transform duration-300"
              @error="handleImageError"
            />
            <svg v-else class="w-16 h-16 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                clip-rule="evenodd"
              ></path>
            </svg>
          </div>

          <!-- 横幅图容器 -->
          <div class="mt-10 w-48 flex items-center justify-center">
            <img
              v-if="fanartImageDataUrl"
              :src="fanartImageDataUrl"
              alt="横幅图"
              class="w-full rounded-lg"
              @error="handleImageError"
            />
            <svg v-else class="w-16 h-16 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                clip-rule="evenodd"
              ></path>
            </svg>
          </div>
        </div>


          <!-- 基本信息 -->
          <div class="flex-1">
            <h1 class="text-3xl font-bold text-white mb-2 drop-shadow-lg">
              {{ selectedItem.name }}
            </h1>

            <h2 class="text-m font-bold mb-2 drop-shadow-lg">
              rngsahsjdhjakhsdjkhdksj
            </h2>

            <!-- 电影信息 -->
            <div>
              <MovieInfo
                v-if="movieInfo"
                :movie-info="movieInfo"
                :poster-url="posterImageDataUrl"
                :loading="false"
              />

              <!-- 文件列表（如果是文件夹） -->
              <!-- <FileList
                v-if="selectedItem.type === 'folder' && selectedItem.files"
                :files="selectedItem.files"
                :selected-item="selectedItem"
              /> -->
            </div>
          </div>
        </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import MovieInfo from './MovieInfo.vue'
import FileList from '@components/FileList.vue'

const props = defineProps({
  selectedItem: {
    type: Object,
    default: () => ({})
  },
  posterImageDataUrl: {
    type: String,
    default: ''
  },
  movieInfo: {
    type: Object,
    default: () => ({})
  },
  fanartImageDataUrl: {
    type: String,
    default: ''
  }
})

watch(() => props.selectedItem, (newVal) => {
  console.log(newVal);
}, {
  immediate: true
})


const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement

  if (target) target.style.display = 'none'
}
</script>
