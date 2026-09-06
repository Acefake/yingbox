<template>
  <div class="mb-6">
    <div class="flex gap-4">
      <!-- 电影信息 -->
      <div class="flex-1 min-w-0">
        <div v-if="loading" class="yb-muted">加载中...</div>
        <div v-else-if="movieInfo">
          <div style="font-size: 13px" class="space-y-2">
            <div v-if="movieInfo.year" class="mi-val">
              <span class="yb-muted">年份:</span> {{ movieInfo.year }}
            </div>
            <div
              v-if="movieInfo.genre && movieInfo.genre.length > 0"
              class="mi-val"
            >
              <span class="yb-muted">类型:</span>
              {{ movieInfo.genre.join(', ') }}
            </div>
            <div v-if="movieInfo.director" class="mi-val">
              <span class="yb-muted">导演:</span> {{ movieInfo.director }}
            </div>
            <div
              v-if="movieInfo.actor && movieInfo.actor.length > 0"
              class="mi-val"
            >
              <span class="yb-muted">演员:</span>
              {{ movieInfo.actor.join(', ') }}
            </div>
            <div v-if="movieInfo.rating" class="mi-val">
              <span class="yb-muted">评分:</span> {{ movieInfo.rating }}
            </div>
            <div v-if="movieInfo.runtime" class="mi-val">
              <span class="yb-muted">时长:</span> {{ movieInfo.runtime }}
            </div>
            <div v-if="movieInfo.country" class="mi-val">
              <span class="yb-muted">国家:</span> {{ movieInfo.country }}
            </div>
            <div v-if="movieInfo.studio" class="mi-val">
              <span class="yb-muted">制片公司:</span>
              {{ movieInfo.studio }}
            </div>
            <div v-if="movieInfo.premiered" class="mi-val">
              <span class="yb-muted">首映日期:</span>
              {{ movieInfo.premiered }}
            </div>
            <div v-if="movieInfo.plot" class="mi-val mt-3">
              <p class="mt-1 text-xs leading-relaxed">{{ movieInfo.plot }}</p>
            </div>
          </div>
        </div>
        <div v-else class="yb-muted text-sm">未找到电影信息</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface MovieInfoType {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actor?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
}

interface Props {
  movieInfo: MovieInfoType
  posterUrl: string
  loading: boolean
}

defineProps<Props>()

defineEmits<{
  downloadPoster: []
}>()
</script>

<style scoped>
.mi-val { color: var(--text-primary); font-size: 13px; }
.mi-val .yb-muted { color: var(--text-secondary); }
</style>
