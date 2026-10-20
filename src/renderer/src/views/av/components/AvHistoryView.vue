<template>
  <section class="av-section">
    <PageHeader title="播放历史" as="h2" description="AV 资源播放记录">
      <template v-if="records.length" #actions>
        <UiIconButton
          icon="trash"
          label="清空播放历史"
          danger
          @click="emit('clear')"
        />
      </template>
    </PageHeader>

    <ul v-if="records.length" class="av-history">
      <li
        v-for="rec in records"
        :key="rec.url"
        class="av-history-item"
        role="button"
        tabindex="0"
        :aria-label="`继续播放 ${rec.vod_name}`"
        @click="emit('resume', rec)"
        @keydown.enter.prevent="emit('resume', rec)"
        @keydown.space.prevent="emit('resume', rec)"
      >
        <div class="av-history-thumb">
          <img
            v-if="!broken.has(rec.url)"
            :src="coverSrc(rec.video || rec)"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="markBroken(rec.url)"
          />
          <UiIcon v-else name="movie" />
        </div>
        <div class="av-history-text">
          <p class="av-history-title">{{ rec.vod_name }}</p>
          <p class="av-history-meta">{{ rec.epName }} · {{ rec._source }}</p>
          <p class="av-history-meta">{{ formatTime(rec.timestamp) }}</p>
          <div v-if="rec.duration > 0" class="av-history-progress">
            <div
              :style="{
                width: `${Math.min(100, (rec.progress / rec.duration) * 100)}%`,
              }"
            />
          </div>
        </div>
      </li>
    </ul>
    <AvStatus v-else icon="history" title="暂无播放记录" />
  </section>
</template>

<script setup lang="ts">
/**
 * AV 播放历史视图：缩略图 + 标题 + 进度条的列表。点击即续播，由父组件处理。
 */
import { reactive } from 'vue'

import PageHeader from '@/components/PageHeader.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'

import { coverSrc, formatTime } from '../av-media'
import AvStatus from './AvStatus.vue'

/** 历史记录的展示字段（完整结构见 Index.vue 的 AvPlayRecord）。 */
interface AvHistoryRecord {
  vod_name: string
  vod_pic: string
  _source: string
  epName: string
  url: string
  timestamp: number
  progress: number
  duration: number
  video: any
}

defineProps<{ records: AvHistoryRecord[] }>()

const emit = defineEmits<{
  resume: [record: AvHistoryRecord]
  clear: []
}>()

/** 封面加载失败的记录，改为显示占位图标。 */
const broken = reactive(new Set<string>())
const markBroken = (url: string): void => {
  broken.add(url)
}
</script>

<style scoped>
.av-history {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.av-history-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  cursor: pointer;
  outline: none;
  transition: var(--transition-fast);
}
.av-history-item:hover {
  background: var(--bg-glass-hover);
}
.av-history-item:focus-visible {
  box-shadow: var(--focus-ring);
}
.av-history-thumb {
  display: grid;
  flex: 0 0 96px;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  color: var(--text-quaternary);
}
.av-history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.av-history-text {
  min-width: 0;
  flex: 1;
}
.av-history-title {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.av-history-meta {
  margin: var(--space-0_5) 0 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.av-history-progress {
  height: 3px;
  margin-top: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.av-history-progress > div {
  height: 100%;
  border-radius: inherit;
  background: var(--text-secondary);
}
</style>
