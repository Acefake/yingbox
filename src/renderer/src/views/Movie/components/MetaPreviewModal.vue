<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="fixed inset-0 z-[960] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="$emit('close')" />

      <div
        class="relative w-[780px] max-h-[88vh] rounded-2xl flex flex-col overflow-hidden"
        style="background: rgba(10,12,18,0.97); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 24px 64px rgba(0,0,0,0.8);"
        @click.stop
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/8 flex-shrink-0">
          <div>
            <div class="text-sm font-semibold text-white/90">元数据预览</div>
            <div class="text-xs text-gray-500 mt-0.5">{{ avid }}</div>
          </div>
          <button
            @click="$emit('close')"
            class="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-all"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- loading -->
        <div v-if="loading" class="flex-1 flex items-center justify-center py-16 text-gray-400 text-sm">
          正在从 JavBus 获取数据...
        </div>

        <!-- error -->
        <div v-else-if="error" class="flex-1 flex items-center justify-center py-16 text-red-400 text-sm px-6">
          {{ error }}
        </div>

        <!-- 内容 -->
        <div v-else-if="meta" class="flex-1 overflow-y-auto p-6 space-y-6">
            <img
              :src="proxyUrl(meta.cover)"
              class="w-auto flex-shrink-0 rounded-lg object-cover"
              style="aspect-ratio: 2/3; max-width: 100%;"
              @error="(e) => (e.target as HTMLImageElement).style.display='none'"
            />
          <!-- 主信息区 -->
          <div class="flex gap-5">
            <!-- 封面 -->
          
            <div class="flex-1 min-w-0 space-y-3">
              <h2 class="text-white font-semibold text-base leading-snug">{{ meta.title }}</h2>
              <!-- 标签 -->
              <div class="flex flex-wrap gap-1.5">
                <span class="px-2 py-0.5 rounded-full text-[11px] bg-blue-900/60 text-blue-300">{{ meta.avid }}</span>
                <span v-if="meta.release_date" class="px-2 py-0.5 rounded-full text-[11px] bg-white/8 text-gray-400">{{ meta.release_date }}</span>
                <span v-if="meta.duration" class="px-2 py-0.5 rounded-full text-[11px] bg-white/8 text-gray-400">{{ meta.duration }}</span>
              </div>
              <!-- 简介 -->
              <p v-if="meta.description" class="text-gray-400 text-[12px] leading-relaxed line-clamp-4">{{ meta.description }}</p>
              <!-- 关键词 -->
              <div v-if="meta.keywords?.length" class="flex flex-wrap gap-1">
                <span v-for="kw in meta.keywords" :key="kw" class="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-500">{{ kw }}</span>
              </div>
              <!-- 下载按钮 -->
              <button
                @click="handleAddVideo"
                :disabled="adding"
                class="mt-2 h-8 px-5 rounded-lg text-sm font-medium transition-all"
                :class="adding ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'"
              >{{ adding ? '提交中...' : '加入下载队列' }}</button>
              <div v-if="addMsg" class="text-[11px] font-mono" :class="addMsg.startsWith('❌') ? 'text-red-400' : 'text-green-400'">{{ addMsg }}</div>
            </div>
          </div>

          <!-- 演员 -->
          <div v-if="meta.actress && Object.keys(meta.actress).length">
            <h3 class="text-white/60 text-[11px] font-semibold uppercase tracking-wider mb-2">演员</h3>
            <div class="flex gap-3 flex-wrap">
              <div
                v-for="(img, name) in meta.actress"
                :key="name"
                class="flex flex-col items-center gap-1"
              >
                <img
                  :src="proxyUrl(img)"
                  :alt="String(name)"
                  class="w-12 h-12 rounded-full object-cover border border-white/10"
                  @error="(e) => (e.target as HTMLImageElement).style.display='none'"
                />
                <span class="text-[10px] text-gray-400 max-w-[48px] truncate text-center">{{ name }}</span>
              </div>
            </div>
          </div>

          <!-- Fanart -->
          <div v-if="meta.fanarts?.length">
            <h3 class="text-white/60 text-[11px] font-semibold uppercase tracking-wider mb-2">预览图</h3>
            <div class="grid grid-cols-3 gap-2">
              <img
                v-for="(img, i) in meta.fanarts"
                :key="i"
                :src="proxyUrl(img)"
                class="w-full rounded-md object-cover cursor-pointer hover:opacity-80 transition-opacity"
                style="aspect-ratio:16/9"
                @click="previewImg = proxyUrl(img)"
                @error="(e) => (e.target as HTMLImageElement).style.display='none'"
              />
            </div>
          </div>

          <!-- 磁力链接 -->
          <div v-if="meta.magnets?.length">
            <h3 class="text-white/60 text-[11px] font-semibold uppercase tracking-wider mb-2">磁力链接 ({{ meta.magnets.length }})</h3>
            <div class="space-y-1.5">
              <div
                v-for="(m, i) in meta.magnets"
                :key="i"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/8 transition-colors group"
              >
                <!-- 序号 -->
                <span class="text-[10px] text-gray-600 w-4 flex-shrink-0">{{ i + 1 }}</span>
                <!-- 文件名 -->
                <span class="text-[11px] text-gray-300 flex-1 truncate font-mono" :title="m.name">{{ m.name || m.magnet.slice(20, 40) + '...' }}</span>
                <!-- 大小 -->
                <span class="text-[10px] text-gray-500 flex-shrink-0 w-16 text-right">{{ m.size }}</span>
                <!-- 日期 -->
                <span class="text-[10px] text-gray-600 flex-shrink-0 w-20 text-right">{{ m.date }}</span>
                <!-- 复制按钮 -->
                <button
                  @click="copyMagnet(m.magnet, i)"
                  class="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all"
                  :class="copiedIndex === i ? 'bg-green-600/30 text-green-400' : 'bg-white/8 text-gray-400 hover:bg-blue-600/30 hover:text-blue-300'"
                >
                  <svg v-if="copiedIndex !== i" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
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
        <div v-if="previewImg" class="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center" @click="previewImg = null">
          <img :src="previewImg" class="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" />
        </div>
      </Teleport>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { backend, type BackendMeta } from '@/api/backend'

const props = defineProps<{
  visible: boolean
  avid: string
}>()

const emit = defineEmits<{
  close: []
}>()

const loading = ref(false)
const error = ref('')
const meta = ref<BackendMeta | null>(null)
const previewImg = ref<string | null>(null)
const adding = ref(false)
const addMsg = ref('')
const copiedIndex = ref<number | null>(null)

async function copyMagnet(magnet: string, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(magnet)
    copiedIndex.value = index
    setTimeout(() => { copiedIndex.value = null }, 2000)
  } catch {
    // fallback
    const el = document.createElement('textarea')
    el.value = magnet
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copiedIndex.value = index
    setTimeout(() => { copiedIndex.value = null }, 2000)
  }
}

const proxyUrl = (url: string) => url ? backend.proxyUrl(url) : ''

watch(() => props.visible, async (v) => {
  if (!v) { meta.value = null; error.value = ''; addMsg.value = ''; return }
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
})

async function handleAddVideo() {
  if (!props.avid) return
  adding.value = true
  addMsg.value = ''
  try {
    const msg = await backend.addVideo(props.avid)
    addMsg.value = `✅ ${msg}`
  } catch (e: unknown) {
    addMsg.value = `❌ ${e instanceof Error ? e.message : '请求失败'}`
  } finally {
    adding.value = false
  }
}
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
.line-clamp-4 {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
