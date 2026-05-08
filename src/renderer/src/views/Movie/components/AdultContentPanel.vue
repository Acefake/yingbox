<template>
  <div class="space-y-6 h-full overflow-y-auto custom-scrollbar pr-2">
    <!-- 封面大图 -->
    <div class="relative rounded-xl overflow-hidden ">
      <img
        v-if="meta?.cover || posterImageDataUrl"
        :src="meta?.cover ? proxyUrl(meta.cover) : posterImageDataUrl"
        class="w-[500px] object-cover"
        style="aspect-ratio: 16/10.5"
        @error="handleImageError"
      />
      <div
        v-else
        class="w-full flex items-center justify-center bg-gray-800/50"
        style="aspect-ratio: 16/10.5"
      >
        <svg class="w-16 h-16 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/>
        </svg>
      </div>
    </div>

    <!-- 主信息区 -->
    <div class="space-y-4">
      <!-- 标题 -->
      <h1 class="text-2xl font-bold text-white leading-snug">
        {{ meta?.title || selectedItem?.name }}
      </h1>

      <!-- 标签 -->
      <div class="flex flex-wrap gap-2">
        <span
          v-if="meta?.avid || avid"
          class="px-2.5 py-1 rounded-full text-xs bg-blue-900/60 text-blue-300 font-medium"
        >
          {{ meta?.avid || avid }}
        </span>
        <span
          v-if="meta?.release_date"
          class="px-2.5 py-1 rounded-full text-xs bg-white/10 text-gray-300"
        >
          {{ meta.release_date }}
        </span>
        <span
          v-if="meta?.duration"
          class="px-2.5 py-1 rounded-full text-xs bg-white/10 text-gray-300"
        >
          {{ meta.duration }}
        </span>
      </div>

      <!-- 简介 -->
      <p
        v-if="meta?.description"
        class="text-gray-400 text-sm leading-relaxed"
      >
        {{ meta.description }}
      </p>

      <!-- 关键词 -->
      <div v-if="meta?.keywords?.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="kw in meta.keywords"
          :key="kw"
          class="px-2 py-0.5 rounded text-[11px] bg-white/5 text-gray-500"
        >
          {{ kw }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-3 pt-2">
        <button
          @click="handleScrape"
          :disabled="loading"
          class="h-10 px-6 rounded-lg text-sm font-medium transition-all"
          :class="loading ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'"
        >
          {{ loading ? '刮削中...' : '刮削' }}
        </button>
      </div>
    </div>

    <!-- 演员 -->
    <div v-if="meta?.actress && Object.keys(meta.actress).length">
      <h3 class="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
        演员
      </h3>
      <div class="flex gap-3 flex-wrap">
        <div
          v-for="(img, name) in meta.actress"
          :key="name"
          class="flex flex-col items-center gap-1"
        >
          <img
            :src="proxyUrl(img)"
            :alt="String(name)"
            class="w-14 h-14 rounded-full object-cover border border-white/10"
            @error="handleAvatarError"
          />
          <span class="text-[11px] text-gray-400 max-w-[56px] truncate text-center">
            {{ name }}
          </span>
        </div>
      </div>
    </div>

    <!-- 演员（从 actors prop） -->
    <div v-else-if="actors && actors.length">
      <h3 class="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
        演员
      </h3>
      <div class="flex gap-3 flex-wrap">
        <div
          v-for="actor in actors"
          :key="actor.name"
          class="flex flex-col items-center gap-1"
        >
          <div class="w-14 h-14 rounded-full overflow-hidden bg-gray-700/60 border border-white/10">
            <img
              v-if="actor.photoDataUrl"
              :src="actor.photoDataUrl"
              :alt="actor.name"
              class="w-full h-full object-cover"
            />
            <svg v-else class="w-6 h-6 text-gray-500 m-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
            </svg>
          </div>
          <span class="text-[11px] text-gray-400 max-w-[56px] truncate text-center">
            {{ actor.name }}
          </span>
        </div>
      </div>
    </div>

    <!-- 预览图 -->
    <div v-if="displayFanarts.length">
      <h3 class="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
        预览图 ({{ displayFanarts.length }})
      </h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <img
          v-for="(img, i) in displayFanarts"
          :key="i"
          :src="img.isLocal ? img.url : proxyUrl(img.url)"
          class="w-full rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
          style="aspect-ratio: 16/9"
          @click="previewImg = img.isLocal ? img.url : proxyUrl(img.url)"
          @error="handleImageError"
        />
      </div>
    </div>

    <!-- 磁力链接 -->
    <div v-if="meta?.magnets?.length">
      <h3 class="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
        磁力链接 ({{ meta.magnets.length }})
      </h3>
      <div class="space-y-2">
        <div
          v-for="(m, i) in meta.magnets"
          :key="i"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/8 transition-colors group"
        >
          <span class="text-[10px] text-gray-600 w-5 flex-shrink-0">{{ i + 1 }}</span>
          <span
            class="text-xs text-gray-300 flex-1 truncate font-mono"
            :title="m.name"
          >
            {{ m.name || m.magnet.slice(20, 40) + '...' }}
          </span>
          <span class="text-[10px] text-gray-500 flex-shrink-0">{{ m.size }}</span>
          <span class="text-[10px] text-gray-600 flex-shrink-0">{{ m.date }}</span>
          <button
            @click="copyMagnet(m.magnet, i)"
            class="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-[10px] bg-blue-600/70 hover:bg-blue-600 text-white transition-all flex-shrink-0"
            :class="{ 'opacity-100': copiedIndex === i }"
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
import { backend, type BackendMeta } from '@/api/backend'
import type { ActorInfo, ProcessedItem } from '@/types'

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
  addToQueue: []
}>()

// 刮削按钮点击处理
const handleScrape = () => {
  if (!props.meta || !props.selectedItem) return
  emit('scrape', props.meta, props.selectedItem)
}

const previewImg = ref<string | null>(null)
const copiedIndex = ref<number | null>(null)

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

const proxyUrl = (url: string) => (url ? backend.proxyUrl(url) : '')

const handleImageError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none'
}

const handleAvatarError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
  target.parentElement?.classList.add('flex', 'items-center', 'justify-center', 'bg-gray-700/60')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'w-6 h-6 text-gray-500')
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
/* 使用全局 custom-scrollbar 样式 */
</style>
