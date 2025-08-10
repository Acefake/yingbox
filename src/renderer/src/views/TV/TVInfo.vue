<template>
  <div class="mb-6">
    <div class="flex gap-4">
      <!-- 电视剧信息 -->
      <div class="flex-1 min-w-0">
        <div v-if="loading" class="text-gray-400">加载中...</div>
        <div v-else-if="tvInfo">
          <div style="font-size: 13px" class="space-y-2">
            <div v-if="tvInfo.year" class="text-gray-300">
              <span class="text-gray-400">年份:</span> {{ tvInfo.year }}
            </div>
            <div v-if="tvInfo.genre && tvInfo.genre.length > 0" class="text-gray-300">
              <span class="text-gray-400">类型:</span>
              {{ tvInfo.genre.join(', ') }}
            </div>
            <div v-if="tvInfo.director" class="text-gray-300">
              <span class="text-gray-400">导演:</span> {{ tvInfo.director }}
            </div>
            <div v-if="tvInfo.actors && tvInfo.actors.length > 0" class="text-gray-300">
              <span class="text-gray-400">演员:</span>
              {{ tvInfo.actors.join(', ') }}
            </div>
            <div v-if="tvInfo.rating" class="text-gray-300">
              <span class="text-gray-400">评分:</span> {{ tvInfo.rating }}
            </div>
            <div v-if="tvInfo.runtime" class="text-gray-300">
              <span class="text-gray-400">时长:</span> {{ tvInfo.runtime }}
            </div>
            <div v-if="tvInfo.country" class="text-gray-300">
              <span class="text-gray-400">国家:</span> {{ tvInfo.country }}
            </div>
            <div v-if="tvInfo.studio" class="text-gray-300">
              <span class="text-gray-400">制片公司:</span>
              {{ tvInfo.studio }}
            </div>
            <div v-if="tvInfo.premiered" class="text-gray-300">
              <span class="text-gray-400">首映日期:</span>
              {{ tvInfo.premiered }}
            </div>
            
            <!-- 季信息区域 -->
            <div v-if="tvInfo.seasons && tvInfo.seasons.length > 0" class="mt-4">
              <div class="text-gray-400 mb-2">季信息:</div>
              <div class="space-y-2">
                <div 
                  v-for="season in tvInfo.seasons" 
                  :key="season.number"
                  class="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50"
                >
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-white font-medium">第 {{ season.number }} 季</span>
                    <span v-if="season.episodeCount" class="text-gray-400 text-xs">
                      {{ season.episodeCount }} 集
                    </span>
                  </div>
                  <div v-if="season.title" class="text-gray-300 text-xs mb-1">
                    {{ season.title }}
                  </div>
                  <div v-if="season.year" class="text-gray-400 text-xs">
                    {{ season.year }}
                  </div>
                  <div v-if="season.plot" class="text-gray-300 text-xs mt-2 leading-relaxed">
                    {{ season.plot }}
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 季信息占位区域（当没有季信息时显示） -->
            <div v-else class="mt-4">
              <div class="text-gray-400 mb-2">季信息:</div>
              <div class="bg-gray-800/30 rounded-lg p-4 border border-gray-700/30 border-dashed">
                <div class="text-gray-500 text-xs text-center">
                  <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                  </svg>
                  暂无季信息，后续将在此处显示
                </div>
              </div>
            </div>
            
            <div v-if="tvInfo.plot" class="text-gray-300 mt-3">
              <span class="text-gray-400">剧情简介:</span>
              <p class="mt-1 text-xs leading-relaxed">{{ tvInfo.plot }}</p>
            </div>
          </div>
        </div>
        <div v-else class="text-gray-400 text-sm">未找到电视剧信息</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 季信息接口
 */
interface Season {
  number: number
  title?: string
  episodeCount?: number
  year?: string
  plot?: string
}

/**
 * 电视剧信息接口
 */
interface TVInfoType {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actors?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
  seasons?: Season[]
}

/**
 * 组件Props接口
 */
interface Props {
  tvInfo: TVInfoType
  posterUrl: string
  loading: boolean
}

defineProps<Props>()

defineEmits<{
  downloadPoster: []
}>()
</script>

<style scoped>
/* 季信息卡片动画效果 */
.bg-gray-800\/50:hover {
  background-color: rgba(31, 41, 55, 0.7);
  transition: background-color 0.2s ease;
}
</style>