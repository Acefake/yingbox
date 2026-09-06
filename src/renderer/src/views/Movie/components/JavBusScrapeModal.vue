<template>
  <Transition name="modal-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[960] flex items-center justify-center"
    >
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="$emit('close')"
      />

      <div
        class="relative w-[780px] max-h-[88vh] rounded-2xl flex flex-col overflow-hidden glass-panel-floating"
        @click.stop
      >
        <!-- 头部 -->
        <div
          class="flex items-center justify-between px-6 py-4 jb-divider flex-shrink-0"
        >
          <div>
            <div class="text-sm font-semibold" style="color: var(--text-primary)">
              JavBus 刮削预览
            </div>
            <div class="text-xs yb-dim mt-0.5">{{ avid }}</div>
          </div>
          <button
            @click="$emit('close')"
            class="w-7 h-7 flex items-center justify-center rounded-md jb-close"
            aria-label="关闭"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- loading -->
        <div
          v-if="loading"
          class="flex-1 flex items-center justify-center py-16 yb-muted text-sm"
        >
          正在从 JavBus 获取数据...
        </div>

        <!-- error -->
        <div
          v-else-if="error"
          class="flex-1 flex flex-col items-center justify-center py-16 gap-4 px-6"
        >
          <span class="text-sm text-center" style="color: var(--danger)">{{ error }}</span>
          <button
            v-if="item"
            @click="emit('manualSearch', item); $emit('close')"
            class="yb-btn-primary text-xs font-semibold"
          >
            手动检索
          </button>
        </div>

        <!-- 内容 -->
        <div v-else-if="meta" class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <!-- 封面 -->
          <img
            :src="proxyUrl(meta.cover)"
            class="w-full flex-shrink-0 rounded-lg object-cover"
            style="aspect-ratio: 16/10.5"
            @error="
              e => ((e.target as HTMLImageElement).style.display = 'none')
            "
          />

          <!-- 主信息区 -->
          <div class="flex gap-5">
            <div class="flex-1 min-w-0 space-y-3">
              <h2 class="font-semibold text-base leading-snug" style="color: var(--text-primary)">
                {{ meta.title }}
              </h2>
              <!-- 标签 -->
              <div class="flex flex-wrap gap-1.5">
                <span class="yb-chip yb-chip-accent">{{ meta.avid }}</span>
                <span
                  v-if="meta.release_date"
                  class="yb-chip"
                >{{ meta.release_date }}</span>
                <span
                  v-if="meta.duration"
                  class="yb-chip"
                >{{ meta.duration }}</span>
              </div>
              <!-- 简介 -->
              <p
                v-if="meta.description"
                class="yb-muted text-[12px] leading-relaxed line-clamp-4"
              >
                {{ meta.description }}
              </p>
              <!-- 关键词 -->
              <div v-if="meta.keywords?.length" class="flex flex-wrap gap-1">
                <span
                  v-for="kw in meta.keywords"
                  :key="kw"
                  class="yb-chip"
                >{{ kw }}</span>
              </div>
              <!-- 操作按钮 -->
              <div class="flex gap-2 pt-1">
                <button
                  @click="handleDirectScrape"
                  :disabled="processing"
                  class="yb-btn-primary text-sm"
                >
                  {{ processing ? '刮削中...' : '刮削' }}
                </button>
              </div>
              <div
                v-if="actionMsg"
                class="text-[11px] font-mono"
                :style="{
                  color:
                    actionMsg.startsWith('❌') || actionMsg.startsWith('刮削失败')
                      ? 'var(--danger)'
                      : 'var(--success)',
                }"
              >
                {{ actionMsg }}
              </div>
            </div>
          </div>

          <!-- 演员 -->
          <div v-if="meta.actress && Object.keys(meta.actress).length">
            <h3 class="yb-label mb-2">
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
                  class="w-12 h-12 rounded-full object-cover jb-avatar"
                  @error="
                    e => ((e.target as HTMLImageElement).style.display = 'none')
                  "
                />
                <span
                  class="text-[10px] yb-muted max-w-[48px] truncate text-center"
                >{{ name }}</span>
              </div>
            </div>
          </div>

          <!-- Fanart -->
          <div v-if="meta.fanarts?.length">
            <h3 class="yb-label mb-2">
              预览图
            </h3>
            <div class="grid grid-cols-3 gap-2">
              <img
                v-for="(img, i) in meta.fanarts"
                :key="i"
                :src="proxyUrl(img)"
                class="w-full rounded-md object-cover cursor-pointer hover:opacity-80 transition-opacity"
                style="aspect-ratio: 16/9"
                @click="previewImg = proxyUrl(img)"
                @error="
                  e => ((e.target as HTMLImageElement).style.display = 'none')
                "
              />
            </div>
          </div>

          <!-- 磁力链接 -->
          <div v-if="meta.magnets?.length">
            <h3 class="yb-label mb-2">
              磁力链接 ({{ meta.magnets.length }})
            </h3>
            <div class="space-y-1.5">
              <div
                v-for="(m, i) in meta.magnets"
                :key="i"
                class="yb-list-row group"
              >
                <span class="yb-dim w-4 flex-shrink-0" style="font-size: 10px">{{
                  i + 1
                }}</span>
                <span
                  class="text-[11px] flex-1 truncate font-mono jb-magnet-name"
                  :title="m.name"
                >{{ m.name || m.magnet.slice(20, 40) + '...' }}</span>
                <span
                  class="yb-dim flex-shrink-0 w-16 text-right"
                  style="font-size: 10px"
                >{{ m.size }}</span>
                <span
                  class="yb-dim flex-shrink-0 w-20 text-right"
                  style="font-size: 10px"
                >{{ m.date }}</span>
                <button
                  @click="copyMagnet(m.magnet, i)"
                  class="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all"
                  :class="
                    copiedIndex === i
                      ? 'yb-status-ok'
                      : 'jb-copy-btn'
                  "
                >
                  <svg
                    v-if="copiedIndex !== i"
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <svg
                    v-else
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {{ copiedIndex === i ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 图片全屏预览 -->
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
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { backend, type BackendMeta } from '@/api/backend'
import type { ProcessedItem } from '@/types'

const props = defineProps<{
  visible: boolean
  avid: string
  item: ProcessedItem | null
}>()

const emit = defineEmits<{
  close: []
  scrape: [meta: BackendMeta, item: ProcessedItem]
  manualSearch: [item: ProcessedItem]
}>()

const loading = ref(false)
const error = ref('')
const meta = ref<BackendMeta | null>(null)
const previewImg = ref<string | null>(null)
const processing = ref(false)
const actionMsg = ref('')
const copiedIndex = ref<number | null>(null)

async function copyMagnet(magnet: string, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(magnet)
    copiedIndex.value = index
    setTimeout(() => {
      copiedIndex.value = null
    }, 2000)
  } catch {
    const el = document.createElement('textarea')
    el.value = magnet
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copiedIndex.value = index
    setTimeout(() => {
      copiedIndex.value = null
    }, 2000)
  }
}

const proxyUrl = (url: string) => (url ? backend.proxyUrl(url) : '')

watch(
  () => props.visible,
  async v => {
    if (!v) {
      meta.value = null
      error.value = ''
      actionMsg.value = ''
      return
    }
    loading.value = true
    error.value = ''
    meta.value = null
    try {
      const data = await backend.fetchMeta(props.avid)
      if (data.error) {
        error.value = `获取失败: ${data.error}`
      } else {
        meta.value = data
      }
    } catch (e: unknown) {
      error.value = `请求失败: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      loading.value = false
    }
  }
)

function handleDirectScrape() {
  if (!meta.value || !props.item) return
  processing.value = true
  actionMsg.value = ''
  emit('scrape', meta.value, props.item)
}

function setResult(msg: string, isError: boolean = false) {
  actionMsg.value = msg
  processing.value = false
  if (!isError) {
    setTimeout(() => {
      actionMsg.value = ''
    }, 3000)
  }
}

function setScrapeError(msg: string) {
  setResult(msg, true)
}

defineExpose({ setResult, setScrapeError })
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.jb-divider { border-bottom: 1px solid var(--separator); }
.jb-close {
  color: var(--text-tertiary);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: var(--transition-fast);
}
.jb-close:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}
.jb-avatar { box-shadow: inset 0 0 0 1px var(--border-subtle); }
.jb-magnet-name { color: var(--text-primary); }
.jb-copy-btn {
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
}
.jb-copy-btn:hover {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
</style>
