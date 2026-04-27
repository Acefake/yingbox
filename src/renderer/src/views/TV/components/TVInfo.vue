<template>
  <div class="mb-2">
    <div v-if="loading" class="text-gray-400 text-sm">加载中...</div>
    <div v-else-if="tvInfo">
      <!-- 标签行 -->
      <div class="flex flex-wrap gap-2 mb-3">
        <span v-if="tvInfo.year" class="info-badge">{{ tvInfo.year }}</span>
        <span v-if="tvInfo.rating" class="info-badge">
          <svg
            class="w-3 h-3 text-yellow-400 inline mr-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
            />
          </svg>
          {{ Number(tvInfo.rating).toFixed(1) }}
        </span>
        <span v-if="tvInfo.status" class="info-badge">{{ tvInfo.status }}</span>
        <span v-if="tvInfo.number_of_seasons" class="info-badge"
          >{{ tvInfo.number_of_seasons }} 季</span
        >
        <span v-if="tvInfo.number_of_episodes" class="info-badge"
          >{{ tvInfo.number_of_episodes }} 集</span
        >
      </div>

      <!-- 类型 -->
      <div
        v-if="tvInfo.genre && tvInfo.genre.length > 0"
        class="flex flex-wrap gap-1.5 mb-3"
      >
        <span v-for="g in tvInfo.genre" :key="g" class="genre-tag">{{
          g
        }}</span>
      </div>

      <!-- 详细信息 -->
      <div class="space-y-1.5 text-[13px]">
        <div v-if="tvInfo.director" class="text-gray-300">
          <span class="text-gray-500 mr-1">创作者</span> {{ tvInfo.director }}
        </div>
        <div
          v-if="tvInfo.actor && tvInfo.actor.length > 0"
          class="text-gray-300"
        >
          <span class="text-gray-500 mr-1">演员</span>
          {{ tvInfo.actor.slice(0, 6).join(' / ') }}
        </div>
        <div v-if="tvInfo.network" class="text-gray-300">
          <span class="text-gray-500 mr-1">播出</span> {{ tvInfo.network }}
        </div>
        <div v-if="tvInfo.premiered" class="text-gray-300">
          <span class="text-gray-500 mr-1">首播</span> {{ tvInfo.premiered }}
        </div>
      </div>

      <!-- 简介 -->
      <p
        v-if="tvInfo.plot"
        class="text-xs text-gray-300/80 leading-relaxed mt-3"
      >
        {{ tvInfo.plot }}
      </p>
    </div>
    <div v-else class="text-gray-500 text-sm">
      未找到电视剧信息，请点击"同步信息"按钮从 TMDB 获取
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TVShowInfoType } from '@/types'

interface Props {
  tvInfo: TVShowInfoType | null
  loading: boolean
}

defineProps<Props>()
</script>

<style scoped>
.info-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}
.genre-tag {
  display: inline-block;
  padding: 1px 8px;
  font-size: 11px;
  color: rgba(147, 197, 253, 0.9);
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.15);
  border-radius: 6px;
}
</style>
