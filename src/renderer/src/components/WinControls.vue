<template>
  <div class="win-controls">
    <button
      v-if="showSettings"
      class="win-btn"
      title="设置"
      aria-label="打开设置"
      @click="emit('openSettings')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19 15l2 1-2 3-2-1a8 8 0 0 1-3 2v2h-4v-2a8 8 0 0 1-3-2l-2 1-2-3 2-1a8 8 0 0 1 0-4l-2-1 2-3 2 1a8 8 0 0 1 3-2V3h4v2a8 8 0 0 1 3 2l2-1 2 3-2 1a8 8 0 0 1 0 5z" /></svg>
    </button>
    <button class="win-btn win-min" title="最小化" aria-label="最小化窗口" @click="minimize">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
    <button
      class="win-btn win-max"
      :title="isMaximized ? '还原' : '最大化'"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      @click="toggleMax"
    >
      <svg v-if="!isMaximized" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="13" height="13" /><rect x="4" y="7" width="13" height="13" /></svg>
    </button>
    <button class="win-btn win-close" title="关闭" aria-label="关闭窗口" @click="close">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

withDefaults(defineProps<{ showSettings?: boolean }>(), { showSettings: false })
const emit = defineEmits<{ (e: 'openSettings'): void }>()

const isMaximized = ref(false)

const api = () => (window as any).api.win

const checkMax = async () => {
  isMaximized.value = await api().isMaximized()
}

const minimize = () => api().minimize()
const toggleMax = () => api().maximize()
const close = () => api().close()

onMounted(() => {
  checkMax()
  window.addEventListener('resize', checkMax)
})
onUnmounted(() => window.removeEventListener('resize', checkMax))
</script>

<style scoped>
.win-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
}
.win-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.win-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}
.win-close:hover {
  background: rgba(229, 57, 53, 0.75);
  border-color: rgba(229, 57, 53, 0.5);
  color: #fff;
}
.win-btn:active {
  transform: scale(0.92);
}
</style>
