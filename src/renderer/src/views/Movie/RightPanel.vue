<template>
  <div class="yb-media-detail rp-root">
    <!-- Movie: portrait poster and film information -->
    <div class="rp-header flex flex-wrap items-start gap-6">
      <div class="rp-poster">
        <img
          v-if="posterImageDataUrl"
          :src="posterImageDataUrl"
          alt="海报"
          class="rp-poster-img block size-full object-cover"
          @error="handleImageError"
        />
        <div v-else class="rp-poster-ph">
          <UiIcon name="movie" size="lg" />
        </div>
      </div>

      <div class="rp-body">
        <PageTitle :title="selectedItem?.name || displayTitle">
          {{ displayTitle }}
        </PageTitle>

        <MovieInfo
          class="rp-meta"
          :movie-info="movieInfo"
          :poster-url="posterImageDataUrl"
          :loading="false"
          :hide-actors="actors.length > 0"
        >
          <template #actions>
            <!-- 一个主操作「播放」，其余为图标按钮 -->
            <div class="rp-actions">
              <UiButton
                v-if="videoFiles.length === 1"
                v-tooltip="videoFiles[0].name"
                variant="primary"
                size="lg"
                icon="play"
                label="播放"
                @click="$emit('playFile', videoFiles[0].path)"
              />
              <UiIconButton
                icon="wand"
                label="刮削"
                variant="secondary"
                size="lg"
                @click="selectedItem && $emit('openWorkbench', selectedItem)"
              />
              <span v-if="videoFiles.length === 1" class="rp-play-size">{{
                formatSize(videoFiles[0].size)
              }}</span>
            </div>
          </template>
        </MovieInfo>

        <div v-if="actors && actors.length" class="rp-actors">
          <p class="yb-label mb-2">演员</p>
          <div class="custom-scrollbar flex gap-3 overflow-x-auto pb-1">
            <div
              v-for="actor in actors"
              :key="actor.name"
              class="flex flex-col items-center flex-shrink-0 w-14"
            >
              <div class="rp-actor-avatar">
                <img
                  v-if="actor.photoDataUrl"
                  :src="actor.photoDataUrl"
                  :alt="actor.name"
                  class="w-full h-full object-cover"
                />
                <UiIcon v-else name="users" size="sm" class="rp-actor-ph" />
              </div>
              <span class="rp-actor-name">{{ actor.name }}</span>
              <span v-if="actor.role" class="rp-actor-role">{{
                actor.role
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Multi-file list -->
    <div v-if="videoFiles.length > 1" class="rp-files">
      <p class="yb-label mb-3">视频文件（{{ videoFiles.length }}）</p>
      <div class="space-y-1.5">
        <div
          v-for="vf in videoFiles"
          :key="vf.path"
          class="yb-list-row rp-file-row"
        >
          <UiIcon name="movie" size="sm" class="rp-file-icon" />
          <span class="flex-1 text-sm truncate rp-file-name" :title="vf.name">{{
            fileDisplayName(vf.name)
          }}</span>
          <span class="rp-file-size">{{ formatSize(vf.size) }}</span>
          <div class="rp-file-actions">
            <UiIconButton
              icon="play"
              label="播放"
              size="sm"
              @click="$emit('playFile', vf.path)"
            />
            <UiIconButton
              icon="trash"
              label="删除"
              size="sm"
              danger
              @click="$emit('deleteFile', vf.path)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import PageTitle from '@/components/PageTitle.vue'
import { computed } from 'vue'
import MovieInfo from '@/views/Movie/MovieInfo.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { resolveMediaDisplayTitle, stripMediaExtension } from '@/utils/avid'
import type { ActorInfo, FileItem, ProcessedItem } from '@/types'

interface Props {
  selectedItem?: ProcessedItem
  posterImageDataUrl?: string
  movieInfo?: Record<string, any> | null
  fanartImageDataUrl?: string
  actors?: ActorInfo[]
}

const props = withDefaults(defineProps<Props>(), {
  selectedItem: undefined,
  posterImageDataUrl: '',
  movieInfo: null,
  fanartImageDataUrl: '',
  actors: () => [],
})

defineEmits<{
  playFile: [path: string]
  deleteFile: [path: string]
  openWorkbench: [item: ProcessedItem]
}>()

const videoExtensions = /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i

const videoFiles = computed<FileItem[]>(() => {
  const item = props.selectedItem
  if (!item?.files) return []
  return item.files.filter(
    (f: FileItem) => f.isFile && videoExtensions.test(f.name)
  )
})

/** Unified display title — matches list once metaTitle is filled. */
const displayTitle = computed(() =>
  resolveMediaDisplayTitle({
    name: props.selectedItem?.name,
    metaTitle: props.selectedItem?.metaTitle,
    metaYear: props.selectedItem?.metaYear,
    movieInfo: props.movieInfo,
  })
)

const fileDisplayName = (name: string): string => stripMediaExtension(name)

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
.rp-root {
  color: var(--text-primary);
}
.rp-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.rp-poster {
  width: 200px;
  flex-shrink: 0;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-md);
  outline: 1px solid var(--border-subtle);
  background: var(--bg-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rp-poster-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center;
}
.rp-poster-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-fill-secondary);
  color: var(--text-quaternary);
}
.rp-body {
  flex: 1;
  min-width: 0;
}
.rp-meta {
  margin-top: var(--space-3);
  margin-bottom: var(--space-4);
}
.rp-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}
.rp-play-size {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.rp-actors {
  margin-top: var(--space-2);
}
.rp-actor-avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}
.rp-actor-name {
  margin-top: 6px;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}
.rp-actor-role {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-files {
  margin-top: var(--space-5);
  max-width: 720px;
}
.rp-file-row {
  gap: var(--space-3);
  min-height: 40px;
}
.rp-file-icon,
.rp-actor-ph {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.rp-file-name {
  color: var(--text-primary);
}
.rp-file-size {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
}
.rp-file-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.rp-file-row:hover .rp-file-actions,
.rp-file-row:focus-within .rp-file-actions {
  opacity: 1;
}

@media (max-width: 720px) {
  .rp-header {
    flex-direction: column;
    align-items: stretch;
  }
  .rp-poster {
    width: 160px;
    margin: 0 auto;
  }
}
</style>
