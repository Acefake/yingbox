<template>
  <!-- 搜索结果弹窗 -->
  <a-modal
    :open="visible"
    :title="`搜索结果 (${tvShows.length}部电视剧)`"
    :width="1000"
    :footer="null"
    :centered="true"
    :destroy-on-close="true"
    @cancel="$emit('close')"
  >
    <div class="max-h-[80vh] overflow-y-auto">
      <div class="grid grid-cols-6 gap-5 my-5">
        <div
          v-for="(item, index) in tvShows"
          :key="index"
          class="p-2 bg-gray-100 rounded-lg overflow-hidden hover:bg-gray-50 transition-all transform hover:scale-102 hover:shadow-xl"
        >
          <!-- 海报图片 -->
          <div class="relative overflow-hidden rounded-md">
            <img
              v-if="item.poster_path"
              :src="item.poster_path"
              :alt="item.name"
              class="h-48 w-full"
              @error="handleImageError"
            />
          </div>

          <!-- 电影信息 -->
          <div class="p-2 w-full">
            <h4 class="text-gray-800 font-medium text-sm mb-2 line-clamp-2">
              {{ item.name }}
            </h4>
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span v-if="item.first_air_date">
                {{ new Date(item.first_air_date).getFullYear() }}
              </span>
              <span v-if="item.vote_average" class="flex items-center gap-1">
                <svg class="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                  ></path>
                </svg>
                {{ item.vote_average.toFixed(1) }}
              </span>
            </div>
            <!-- <p
              v-if="item.overview"
              class="text-gray-600 text-xs mt-2 line-clamp-3"
            >
              {{ item.overview }}
            </p> -->

            <div class="pt-2 flex gap-2">
              <div class="w-full">
                <a-button block @click="$emit('scrape', item)"> 添加到队列 </a-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { Button as AButton, Modal as AModal } from 'ant-design-vue'
import type { TVShow } from '@tdanks2000/tmdb-wrapper'

/**
 * 组件属性接口
 */
interface Props {
  visible: boolean
  tvShows: TVShow[]
}

defineProps<Props>()

/**
 * 组件事件定义
 */
defineEmits<{
  close: []
  scrape: [tvShow: TVShow]
}>()

/**
 * 处理图片加载错误
 */
const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement | null

  if (target) {
    target.style.display = 'none'
  }
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
