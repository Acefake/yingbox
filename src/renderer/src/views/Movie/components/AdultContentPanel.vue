<template>
  <div class="yb-media-detail adult-rp">
    <!-- Top full-width cover banner (adult-specific; not shared portrait poster) -->
    <div class="adult-cover-banner">
      <img
        v-if="heroImage"
        :src="heroImage"
        alt="封面"
        class="adult-cover-img"
        @error="handleImageError"
      />
      <div v-else class="adult-cover-ph">
        <svg class="w-14 h-14 yb-icon-muted" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
    </div>

    <div class="yb-media-meta adult-meta">
      <h1 class="yb-page-title adult-title" :title="selectedItem?.name || displayTitle">
        {{ displayTitle }}
      </h1>

      <div class="adult-chips">
        <span
          v-if="meta?.avid || avid"
          class="yb-chip yb-chip-accent"
        >
          {{ meta?.avid || avid }}
        </span>
        <span
          v-if="meta?.release_date"
          class="yb-chip"
        >
          {{ meta.release_date }}
        </span>
        <span
          v-if="meta?.duration"
          class="yb-chip"
        >
          {{ meta.duration }}
        </span>
      </div>

      <p
        v-if="meta?.description"
        class="adult-desc yb-muted line-clamp-4"
      >
        {{ meta.description }}
      </p>

      <div v-if="meta?.keywords?.length" class="adult-keywords">
        <span
          v-for="kw in meta.keywords"
          :key="kw"
          class="yb-chip"
        >
          {{ kw }}
        </span>
      </div>

      <!-- 演员（优先 meta.actress，否则 actors prop） -->
      <div v-if="meta?.actress && Object.keys(meta.actress).length" class="adult-actors">
        <p class="yb-label mb-2">演员</p>
        <div class="custom-scrollbar flex gap-3 overflow-x-auto pb-1">
          <div
            v-for="(img, name) in meta.actress"
            :key="name"
            class="flex flex-col items-center flex-shrink-0 w-14"
          >
            <img
              :src="proxyUrl(img)"
              :alt="String(name)"
              class="adult-actor-avatar"
              @error="handleAvatarError"
            />
            <span class="adult-actor-name">{{ name }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="actors && actors.length" class="adult-actors">
        <p class="yb-label mb-2">演员</p>
        <div class="custom-scrollbar flex gap-3 overflow-x-auto pb-1">
          <div
            v-for="actor in actors"
            :key="actor.name"
            class="flex flex-col items-center flex-shrink-0 w-14"
          >
            <div class="adult-actor-avatar adult-actor-avatar--ph">
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
            <span class="adult-actor-name">{{ actor.name }}</span>
          </div>
        </div>
      </div>

      <!-- Secondary actions -->
      <div class="yb-media-toolbar adult-toolbar">
        <button
          v-if="videoFiles.length === 1"
          class="rp-play-btn-primary"
          type="button"
          :title="videoFiles[0].name"
          @click="emit('playFile', videoFiles[0].path)"
        >
          <svg class="rp-play-btn-icon" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          <span>播放</span>
        </button>
        <button
          class="yb-btn-primary"
          :disabled="loading"
          @click="handleScrape"
        >
          {{ loading ? '刮削中...' : (meta ? '加入队列' : '打开刮削工作台') }}
        </button>
        <span
          v-if="videoFiles.length === 1"
          class="rp-play-size yb-dim"
        >{{ formatSize(videoFiles[0].size) }}</span>
      </div>
      <div
        v-if="actionMsg"
        class="adult-action-msg"
        :class="actionMsgIsError ? 'is-error' : 'is-ok'"
      >
        {{ actionMsg }}
      </div>
    </div>

    <!-- Multi-file list -->
    <div v-if="videoFiles.length > 1" class="yb-media-section adult-files">
      <p class="yb-label mb-3">视频文件 ({{ videoFiles.length }})</p>
      <div class="space-y-1.5">
        <div
          v-for="vf in videoFiles"
          :key="vf.path"
          class="yb-list-row group adult-file-row"
        >
          <svg class="w-4 h-4 yb-icon-muted flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          <span class="flex-1 text-sm truncate adult-file-name" :title="vf.name">{{ fileDisplayName(vf.name) }}</span>
          <span class="yb-dim flex-shrink-0" style="font-size: 11px">{{ formatSize(vf.size) }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 adult-play-btn"
            title="播放"
            @click="emit('playFile', vf.path)"
          >
            播放
          </button>
          <button
            class="opacity-0 group-hover:opacity-100 adult-del-btn"
            title="删除"
            @click="emit('deleteFile', vf.path)"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 预览图 -->
    <div v-if="displayFanarts.length" class="yb-media-section">
      <h3 class="yb-label mb-3">
        预览图 ({{ displayFanarts.length }})
      </h3>
      <div class="adult-fanart-grid">
        <img
          v-for="(img, i) in displayFanarts"
          :key="i"
          :src="img.isLocal ? img.url : proxyUrl(img.url)"
          class="adult-fanart"
          @click="previewImg = img.isLocal ? img.url : proxyUrl(img.url)"
          @error="handleImageError"
        />
      </div>
    </div>

    <!-- 磁力链接 -->
    <div v-if="meta?.magnets?.length" class="yb-media-section">
      <h3 class="yb-label mb-3">
        磁力链接 ({{ meta.magnets.length }})
      </h3>
      <div class="space-y-2">
        <div
          v-for="(m, i) in meta.magnets"
          :key="i"
          class="yb-list-row group"
        >
          <span class="yb-dim w-5 flex-shrink-0" style="font-size: 11px">{{ i + 1 }}</span>
          <span
            class="text-xs adult-file-name flex-1 truncate font-mono"
            :title="m.name"
          >
            {{ m.name || m.magnet.slice(20, 40) + '...' }}
          </span>
          <span class="yb-dim flex-shrink-0" style="font-size: 11px">{{ m.size }}</span>
          <span class="yb-dim flex-shrink-0" style="font-size: 11px">{{ m.date }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-[10px] yb-btn-primary transition-all flex-shrink-0"
            :class="{ 'opacity-100': copiedIndex === i }"
            @click="copyMagnet(m.magnet, i)"
          >
            {{ copiedIndex === i ? '已复制' : '复制' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 图片预览 -->
    <Teleport to="body">
      <div
        v-if="previewImg"
        class="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center"
        @click="previewImg = null"
      >
        <img
          :src="previewImg"
          class="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
        />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { type BackendMeta, backend } from '@/api/backend'
import { resolveMediaDisplayTitle, stripMediaExtension } from '@/utils/avid'
import type { ActorInfo, FileItem, ProcessedItem } from '@/types'

interface Props {
  selectedItem?: ProcessedItem
  meta?: BackendMeta | null
  posterImageDataUrl?: string
  fanartImageDataUrl?: string
  localFanarts?: string[]  // 本地已下载的 fanarts 路径
  actors?: ActorInfo[]
  loading?: boolean
  actionMsg?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  scrape: [meta: BackendMeta, item: ProcessedItem]
  /** 无元数据时打开统一刮削工作台 */
  openWorkbench: [item: ProcessedItem]
  playFile: [path: string]
  deleteFile: [path: string]
}>()

// 刮削按钮：有预览元数据则直接入队；否则打开工作台（不静默）
const handleScrape = () => {
  if (!props.selectedItem) return
  if (props.meta) {
    emit('scrape', props.meta, props.selectedItem)
    return
  }
  emit('openWorkbench', props.selectedItem)
}

const previewImg = ref<string | null>(null)
const copiedIndex = ref<number | null>(null)

const heroImage = computed(() => {
  if (props.meta?.cover) return proxyUrl(props.meta.cover)
  return props.posterImageDataUrl || ''
})

const actionMsgIsError = computed(() => {
  const msg = props.actionMsg || ''
  return msg.startsWith('❌') || msg.startsWith('刮削失败')
})

// 合并本地和网络 fanarts，优先使用本地
const displayFanarts = computed(() => {
  const local = props.localFanarts || []
  // 如果有本地 fanarts，优先使用
  if (local.length > 0) {
    return local.map(url => ({ url, isLocal: true }))
  }
  // 否则使用网络的
  const network = props.meta?.fanarts || []
  return network.map(url => ({ url, isLocal: false }))
})

// 从文件名提取 AV 号
const avid = computed(() => {
  if (props.meta?.avid) return props.meta.avid
  const name = props.selectedItem?.name || ''
  const match = name.match(/([A-Z]{2,6})-?\s*(\d{2,4})/i)
  return match ? `${match[1].toUpperCase()}-${match[2]}` : ''
})

/** Unified display title — matches list once meta is filled. */
const displayTitle = computed(() =>
  resolveMediaDisplayTitle({
    name: props.selectedItem?.name,
    metaTitle: props.selectedItem?.metaTitle,
    metaYear: props.selectedItem?.metaYear,
    meta: props.meta,
  })
)

const fileDisplayName = (name: string): string => stripMediaExtension(name)

const videoExtensions = /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i

const videoFiles = computed<FileItem[]>(() => {
  const item = props.selectedItem
  if (!item?.files) return []
  return item.files.filter(
    (f: FileItem) => f.isFile && videoExtensions.test(f.name)
  )
})

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const proxyUrl = (url: string) => {
  if (!url) return ''
  // local:// URL 直接使用，不走代理
  if (url.startsWith('local://')) return url
  return backend.proxyUrl(url)
}

const handleImageError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none'
}

const handleAvatarError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
  target.parentElement?.classList.add('flex', 'items-center', 'justify-center', 'yb-poster-ph')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'w-6 h-6 yb-icon-muted')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.innerHTML = '<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>'
  target.parentElement?.appendChild(svg)
}

async function copyMagnet(magnet: string, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(magnet)
    copiedIndex.value = index
    setTimeout(() => copiedIndex.value = null, 2000)
  } catch {
    const el = document.createElement('textarea')
    el.value = magnet
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copiedIndex.value = index
    setTimeout(() => copiedIndex.value = null, 2000)
  }
}
</script>

<style scoped>
.adult-rp { color: var(--text-primary); }
/* Full-width cover stage: keep ~16:10.5 landscape strip height; width fills panel */
.adult-cover-banner {
  width: 100%;
  aspect-ratio: 16 / 10.5;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: var(--space-6);
  box-shadow: var(--shadow-md);
  outline: 1px solid var(--border-subtle);
  background: var(--bg-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.adult-cover-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  object-position: center;
}
.adult-cover-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-fill-secondary);
}
.adult-meta {
  width: 100%;
  min-width: 0;
  margin-bottom: var(--space-2);
}
.adult-title {
  font-size: clamp(22px, 2.4vw, 28px);
  letter-spacing: -0.025em;
  margin: 0 0 var(--space-1);
  line-height: 1.2;
}
.adult-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.adult-desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: 1.55;
}
.adult-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--space-3);
}
.adult-actors { margin-top: var(--space-1); margin-bottom: var(--space-3); }
.adult-actor-avatar {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  object-fit: cover;
  display: block;
  box-shadow: inset 0 0 0 1px var(--border-subtle);
  background: var(--bg-fill-secondary);
}
.adult-actor-avatar--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.adult-actor-name {
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
.adult-toolbar { margin-top: var(--space-1); gap: var(--space-2); align-items: center; }
.adult-action-msg {
  margin-top: var(--space-2);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.adult-action-msg.is-ok { color: var(--success); }
.adult-action-msg.is-error { color: var(--danger); }
.adult-play-wrap {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: 12px;
}
.rp-play-size,
.adult-play-wrap .rp-play-size {
  font-size: var(--text-xs);
}
.adult-files { max-width: 720px; }
.adult-file-row { min-height: 40px; }
.adult-file-name { color: var(--text-primary); }
.adult-play-btn,
.adult-del-btn {
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
.adult-play-btn { color: var(--success); }
.adult-play-btn:hover { background: color-mix(in srgb, var(--success) 14%, transparent); }
.adult-del-btn { color: var(--danger); }
.adult-del-btn:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); }
.adult-fanart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
@media (min-width: 640px) {
  .adult-fanart-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.adult-fanart {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid var(--border-subtle);
  background: var(--bg-fill-secondary);
  transition: opacity var(--transition-fast), transform 100ms ease-out;
}
.adult-fanart:hover { opacity: 0.88; }
.adult-fanart:active { transform: scale(0.98); }
@media (prefers-reduced-motion: reduce) {
  .adult-fanart:active { transform: none; }
}
</style>