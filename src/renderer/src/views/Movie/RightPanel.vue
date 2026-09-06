<template>
  <div class="yb-media-detail rp-root">
    <!-- Movie: left portrait poster + right info (adult banner stays in AdultContentPanel) -->
    <div class="rp-header">
      <div class="rp-poster">
        <img
          v-if="posterImageDataUrl"
          :src="posterImageDataUrl"
          alt="海报"
          class="rp-poster-img"
          @error="handleImageError"
        />
        <div v-else class="rp-poster-ph">
          <svg class="w-14 h-14 yb-icon-muted" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
      </div>

      <div class="rp-body">
        <h1 class="yb-page-title rp-title" :title="selectedItem?.name || displayTitle">
          {{ displayTitle }}
        </h1>

        <div class="rp-meta">
          <MovieInfo
            v-if="movieInfo"
            :movie-info="movieInfo"
            :poster-url="posterImageDataUrl"
            :loading="false"
          />
        </div>

        <div class="yb-media-toolbar rp-action-bar">
          <button
            v-if="videoFiles.length === 1"
            class="rp-play-btn-primary"
            type="button"
            :title="videoFiles[0].name"
            @click="$emit('playFile', videoFiles[0].path)"
          >
            <svg class="rp-play-btn-icon" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            <span>播放</span>
          </button>
          <button
            class="yb-btn-soft text-sm"
            type="button"
            @click="selectedItem && $emit('openWorkbench', selectedItem)"
          >
            刮削
          </button>
          <span
            v-if="videoFiles.length === 1"
            class="rp-play-size yb-dim"
          >{{ formatSize(videoFiles[0].size) }}</span>
        </div>

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
                <svg
                  v-else
                  class="w-5 h-5 yb-icon-muted"
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
              <span class="rp-actor-name">{{ actor.name }}</span>
              <span v-if="actor.role" class="rp-actor-role">{{ actor.role }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Multi-file list -->
    <div v-if="videoFiles.length > 1" class="rp-files">
      <p class="yb-label mb-3">视频文件（{{ videoFiles.length }}）</p>
      <div class="space-y-1.5">
        <div v-for="vf in videoFiles" :key="vf.path" class="yb-list-row group rp-file-row">
          <svg class="w-4 h-4 yb-icon-muted flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          <span class="flex-1 text-sm truncate rp-file-name" :title="vf.name">{{ fileDisplayName(vf.name) }}</span>
          <span class="yb-dim flex-shrink-0" style="font-size: 11px">{{ formatSize(vf.size) }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 rp-play-btn"
            title="播放"
            @click="$emit('playFile', vf.path)"
          >
            播放
          </button>
          <button
            class="opacity-0 group-hover:opacity-100 rp-del-btn"
            title="删除"
            @click="$emit('deleteFile', vf.path)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MovieInfo from '@/views/Movie/MovieInfo.vue'
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
.rp-root { color: var(--text-primary); }
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
}
.rp-body {
  flex: 1;
  min-width: 0;
}
.rp-title {
  font-size: clamp(22px, 2.4vw, 28px);
  letter-spacing: -0.025em;
  margin: 0 0 var(--space-1);
  line-height: 1.2;
}
.rp-meta { margin-bottom: var(--space-4); }
.rp-action-bar { margin-bottom: var(--space-3); gap: var(--space-2); align-items: center; }
.rp-actors { margin-top: var(--space-2); }
.rp-actor-avatar {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}
.rp-actor-name {
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-secondary);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}
.rp-actor-role {
  font-size: 9px;
  color: var(--text-tertiary);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-play-wrap {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: 12px;
}
.rp-play-size {
  font-size: var(--text-xs);
}
.rp-files { margin-top: var(--space-5); max-width: 720px; }
.rp-file-row { min-height: 40px; }
.rp-file-name { color: var(--text-primary); }
.rp-play-btn,
.rp-del-btn {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: var(--transition-fast);
}
.rp-play-btn { color: var(--success); }
.rp-play-btn:hover { background: color-mix(in srgb, var(--success) 14%, transparent); }
.rp-del-btn { color: var(--danger); }
.rp-del-btn:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); }

@media (max-width: 720px) {
  .rp-header { flex-direction: column; align-items: stretch; }
  .rp-poster { width: 160px; margin: 0 auto; }
}
</style>
