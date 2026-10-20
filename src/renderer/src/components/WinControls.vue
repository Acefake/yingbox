<template>
  <div v-if="showWindowButtons" class="win-controls">
    <UiIconButton icon="minimize" label="最小化" @click="minimize" />
    <UiIconButton
      :icon="isMaximized ? 'restore' : 'maximize'"
      :label="isMaximized ? '还原' : '最大化'"
      @click="toggleMax"
    />
    <UiIconButton
      class="win-close"
      icon="close"
      label="关闭"
      danger
      @click="close"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 无边框窗口的最小化 / 最大化（还原）/ 关闭按钮。
 * 只在 Electron 里显示；最大化状态随窗口 resize 同步，图标在 maximize / restore 间切换。
 */
import { onMounted, onUnmounted, ref } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'

withDefaults(defineProps<{ showWindowButtons?: boolean }>(), {
  showWindowButtons: true,
})

const isMaximized = ref(false)

const api = (): Window['api']['win'] | undefined => window.api?.win

const checkMax = async (): Promise<void> => {
  const win = api()
  if (!win) return
  isMaximized.value = await win.isMaximized()
}

const minimize = (): void => void api()?.minimize()
const toggleMax = (): void => void api()?.maximize()
const close = (): void => void api()?.close()

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
  gap: var(--space-1);
  -webkit-app-region: no-drag;
}
</style>
