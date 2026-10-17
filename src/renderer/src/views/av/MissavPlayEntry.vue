<template>
  <form class="px-4 pt-3 pb-1" @submit.prevent="play">
    <label for="missav-play-input" class="mb-2 block text-sm font-medium"
      >MissAV 在线播放</label
    >
    <div class="flex gap-2">
      <input
        id="missav-play-input"
        v-model="input"
        class="h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm"
        style="
          background: var(--bg-input, transparent);
          border-color: var(--border-color);
          color: var(--text-primary);
        "
        placeholder="粘贴 MissAV 视频链接或输入番号"
        maxlength="2048"
        autocomplete="off"
        :disabled="loading"
      />
      <button
        type="submit"
        class="av-ghost-btn h-10 shrink-0 rounded-lg px-4 text-sm disabled:opacity-50"
        :disabled="loading || !input.trim()"
      >
        {{ loading ? '正在解析…' : '立即播放' }}
      </button>
      <button
        v-if="loading"
        type="button"
        class="av-ghost-btn h-10 rounded-lg px-3 text-sm"
        @click="cancel"
      >
        取消
      </button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="mt-2 text-sm"
      style="color: var(--danger)"
    >
      {{ error }}
    </p>
    <p v-else class="mt-2 text-xs" style="color: var(--text-muted)">
      解析后缓冲播放，无需下载完整视频；可拖动进度。
    </p>
  </form>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { type MissavStream, resolveMissav } from '@/api/missav'

const emit = defineEmits<{ play: [stream: MissavStream] }>()
const input = ref('')
const loading = ref(false)
const error = ref('')
let controller: AbortController | undefined
const cancel = (): void => controller?.abort()
onBeforeUnmount(cancel)

async function play(): Promise<void> {
  if (loading.value || !input.value.trim()) return
  controller = new AbortController()
  const active = controller
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    active.abort()
  }, 85000)
  loading.value = true
  error.value = ''
  try {
    const stream = await resolveMissav(input.value.trim(), active.signal)
    if (!active.signal.aborted) emit('play', stream)
  } catch (reason) {
    if (timedOut) error.value = '解析超时，请检查网络或稍后重试'
    else if (!active.signal.aborted)
      error.value = reason instanceof Error ? reason.message : '解析失败'
  } finally {
    window.clearTimeout(timer)
    loading.value = false
    controller = undefined
  }
}
</script>
