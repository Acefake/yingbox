<template>
  <Transition name="modal-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[950] flex items-center justify-center"
    >
      <!-- 遮罩 -->
      <div
        class="absolute inset-0 bg-black/50 backdrop-blur-sm"
        @click="$emit('cancel')"
      />

      <!-- 弹窗 -->
      <div
        class="relative w-[420px] rounded-2xl flex flex-col glass-panel-floating"
        @click.stop
      >
        <!-- 头部 -->
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-white/8"
        >
          <div>
            <div class="text-sm font-semibold text-white/90">下载视频</div>
            <div class="text-xs text-gray-500 mt-0.5 truncate max-w-[280px]">
              {{ avid || '请选择下载源' }}
            </div>
          </div>
          <button
            @click="$emit('cancel')"
            class="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-all"
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

        <!-- 下载源列表 -->
        <div class="px-5 py-4 space-y-2 overflow-y-auto max-h-[360px] custom-scrollbar">
          <p class="text-[11px] text-gray-500 mb-3">
            选择下载源（按推荐权重排序）
          </p>
          <div
            v-for="site in sortedSites"
            :key="site.downloaderName"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
            :class="
              selected === site.downloaderName
                ? 'bg-white/20 border border-white/25'
                : 'bg-white/5 border border-transparent hover:bg-white/10'
            "
            @click="selected = site.downloaderName"
          >
            <!-- 单选圆点 -->
            <div
              class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
              :class="
                selected === site.downloaderName
                  ? 'border-blue-400 bg-blue-400'
                  : 'border-gray-600'
              "
            >
              <div
                v-if="selected === site.downloaderName"
                class="w-1.5 h-1.5 rounded-full bg-white"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-white/90">
                {{ site.downloaderName }}
              </div>
              <div class="text-[10px] text-gray-500">{{ site.domain }}</div>
            </div>
            <!-- 权重标签 -->
            <span
              class="text-[9px] px-1.5 py-0.5 rounded font-mono"
              :class="
                site.weight > 0
                  ? 'bg-green-900/60 text-green-400'
                  : 'bg-gray-800 text-gray-500'
              "
              >{{ site.weight > 0 ? '推荐' : '禁用' }}</span
            >
          </div>
        </div>

        <!-- 结果提示 -->
        <div
          v-if="resultMsg || queueStatus"
          class="mx-5 mb-3 px-3 py-2 rounded-lg bg-black/40 border border-white/8 text-[11px] text-gray-300 font-mono space-y-1"
        >
          <div v-if="resultMsg">{{ resultMsg }}</div>
          <div v-if="queueStatus">{{ queueStatus }}</div>
        </div>

        <!-- 底部操作 -->
        <div class="px-5 py-4 border-t border-white/8 flex items-center gap-3">
          <button
            @click="handleDownload"
            :disabled="!selected || downloading"
            class="flex-1 h-9 rounded-lg text-sm font-medium transition-all"
            :class="
              selected && !downloading
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-white/5 text-gray-500 cursor-not-allowed'
            "
          >
            {{ downloading ? '提交中...' : '开始下载' }}
          </button>
          <button
            @click="$emit('cancel')"
            class="h-9 px-4 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-all"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { backend } from '@/api/backend'

interface DownloaderSite {
  downloaderName: string
  domain: string
  weight: number
}

const props = defineProps<{
  visible: boolean
  avid: string
  sites: DownloaderSite[]
}>()

const emit = defineEmits<{
  cancel: []
  done: [avid: string, msg: string]
}>()

const selected = ref('')
const downloading = ref(false)
const resultMsg = ref('')
const queueStatus = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const sortedSites = computed(() =>
  [...props.sites].sort((a, b) => b.weight - a.weight)
)

watch(
  () => props.visible,
  v => {
    if (v) {
      resultMsg.value = ''
      queueStatus.value = ''
      downloading.value = false
      const first = sortedSites.value.find(s => s.weight > 0)
      selected.value =
        first?.downloaderName ?? sortedSites.value[0]?.downloaderName ?? ''
    } else {
      stopPolling()
    }
  }
)

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling(avid: string) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const queue = await backend.getQueue()
      if (queue.includes(avid)) {
        queueStatus.value = `⏳ 排队中 (队列第 ${queue.indexOf(avid) + 1} 位)`
      } else {
        queueStatus.value = '✅ 已完成或不在队列中'
        stopPolling()
      }
    } catch {
      stopPolling()
    }
  }, 3000)
}

onUnmounted(() => stopPolling())

async function handleDownload() {
  if (!selected.value || !props.avid) return
  downloading.value = true
  resultMsg.value = ''
  try {
    const msg = await backend.addVideo(props.avid)
    resultMsg.value = msg
    emit('done', props.avid, msg)
    startPolling(props.avid)
  } catch (e: unknown) {
    resultMsg.value = `❌ ${e instanceof Error ? e.message : '请求失败'}`
  } finally {
    downloading.value = false
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
</style>
