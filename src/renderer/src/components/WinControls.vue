<template>
  <div class="win-controls">
    <button
      v-if="showWindowButtons"
      class="win-btn win-min"
      title="最小化"
      aria-label="最小化窗口"
      @click="minimize"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
    <button
      v-if="showWindowButtons"
      class="win-btn win-max"
      :title="isMaximized ? '还原' : '最大化'"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      @click="toggleMax"
    >
      <svg v-if="!isMaximized" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="4" width="13" height="13" />
        <rect x="4" y="7" width="13" height="13" />
      </svg>
    </button>
    <button
      v-if="showWindowButtons"
      class="win-btn win-close"
      title="关闭"
      aria-label="关闭窗口"
      @click="close"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

withDefaults(
  defineProps<{ showWindowButtons?: boolean }>(),
  {
    showWindowButtons: true,
  }
)

const isMaximized = ref(false)

const api = () => window.api?.win

const checkMax = async () => {
  const win = api()
  if (!win) return
  isMaximized.value = await win.isMaximized()
}

const minimize = () => api()?.minimize()
const toggleMax = () => api()?.maximize()
const close = () => api()?.close()

onMounted(() => {
  if (!api()) return
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
  width: 34px;
  height: 34px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}
.win-btn svg {
  width: var(--icon-md, 16px);
  height: var(--icon-md, 16px);
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: var(--icon-stroke, 1.75);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.win-btn:hover {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
.win-close:hover {
  background: rgba(255, 59, 48, 0.9);
  color: #fff;
}
.win-btn:active {
  transform: scale(0.94);
}
</style>
