<template>
  <div v-if="history.length" class="home-section">
    <div class="section-header">
      <span class="section-title">播放记录</span>
      <button class="clear-btn" @click="emit('clear')">清空</button>
    </div>
    <div v-scroll-x class="play-history-list">
      <div v-for="rec in history" :key="rec.url" class="play-record-card" @click="emit('open', rec)">
        <img :src="rec.vod_pic" class="rec-poster" @error="onImgError" />
        <div class="rec-info">
          <div class="rec-title">{{ rec.vod_name }}</div>
          <div class="rec-ep">{{ rec.groupLabel }} · {{ rec.epName }}</div>
          <div class="rec-time">{{ formatTime(rec.timestamp) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CmsItem } from '../composables/use-online-search'

export interface PlayRecord {
  vod_name: string
  vod_pic: string
  epName: string
  url: string
  groupLabel: string
  timestamp: number
  item: CmsItem
}

defineProps<{ history: PlayRecord[] }>()
const emit = defineEmits<{
  (e: 'clear'): void
  (e: 'open', rec: PlayRecord): void
}>()

const onImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
}

const formatTime = (ts: number) => {
  const d = new Date(ts)
  const now = new Date()
  const diff = (now.getTime() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (d.toDateString() === now.toDateString()) return '今天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.clear-btn {
  font-size: 11px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}

.clear-btn:hover { color: rgba(255, 255, 255, 0.8); }

.play-history-list {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.play-history-list::-webkit-scrollbar { height: 3px; }
.play-history-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.play-record-card {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 200px;
  max-width: 240px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.play-record-card:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
}

.rec-poster {
  width: 40px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.rec-info { overflow: hidden; }

.rec-title {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-ep {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-time {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
}
</style>
