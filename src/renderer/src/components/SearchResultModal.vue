<template>
  <!-- 搜索结果弹窗 -->
  <AModal
    :open="visible"
    :title="`搜索结果 (${movies.length}部电影)`"
    :width="1000"
    :footer="null"
    :centered="true"
    :destroy-on-close="true"
    :z-index="9999"
    @cancel="$emit('close')"
  >
    <div class="max-h-[80vh] overflow-y-auto">
      <div v-if="movies.length === 0" class="text-center py-8 text-gray-500">
        <p>没有搜索结果</p>
      </div>
      <div v-else class="grid grid-cols-6 gap-5 my-5">
        <div
          v-for="(item, index) in movies"
          :key="index"
          class="p-2 bg-gray-100 rounded-lg overflow-hidden hover:bg-gray-50 transition-all transform hover:scale-102 hover:shadow-xl"
        >
          <!-- 海报图片 -->
          <div class="relative overflow-hidden rounded-md">
            <img
              v-if="item.poster_path"
              :src="item.poster_path"
              :alt="item.title"
              class="h-48 w-full object-cover"
              @error="handleImageError"
            />
            <div v-else class="h-48 w-full bg-gray-200 flex items-center justify-center">
              <span class="text-gray-500 text-sm">无海报</span>
            </div>
          </div>

          <!-- 电影信息 -->
          <div class="p-2 w-full">
            <h4 class="text-gray-800 font-medium text-sm mb-2 line-clamp-2">
              {{ item.title }}
            </h4>
            <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span v-if="item.release_date">
                {{ new Date(item.release_date).getFullYear() }}
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

            <div class="pt-2">
              <AButton 
                type="primary" 
                block 
                @click="handleAddToQueue(item)"
                :loading="addingToQueue === item.id"
              >
                {{ addingToQueue === item.id ? '添加中...' : '添加到队列' }}
              </AButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AModal>
</template>

<script setup lang="ts">
import { Button as AButton, Modal as AModal, message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { ref } from 'vue'

/**
 * 组件属性接口
 */
interface Props {
  visible: boolean
  movies: Movie[]
}

const props = defineProps<Props>()

/**
 * 组件事件定义
 */
const emit = defineEmits<{
  close: []
  scrape: [movie: Movie]
}>()

// 添加状态管理
const addingToQueue = ref<number | null>(null)

/**
 * 处理添加到队列
 */
const handleAddToQueue = async (movie: Movie): Promise<void> => {
  try {
    addingToQueue.value = movie.id
    console.log('正在添加电影到队列:', movie.title)
    
    // 触发父组件的scrape事件
    emit('scrape', movie)
    
    message.success(`已添加 "${movie.title}" 到刮削队列`)
  } catch (error) {
    console.error('添加到队列失败:', error)
    message.error('添加到队列失败，请重试')
  } finally {
    addingToQueue.value = null
  }
}

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

/* 优化按钮样式 */
.ant-btn {
  transition: all 0.3s ease;
}

.ant-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>
