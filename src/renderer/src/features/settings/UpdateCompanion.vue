<script setup lang="ts">
/** 安装等待窗口，复用动态品牌标志，不接触主应用 API。 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import UiBrandLogo from '@/components/ui/UiBrandLogo.vue'
import UiButton from '@/components/ui/UiButton.vue'
import type { BrandColor } from '../../../../shared/brand'

type InstallStage = 'exiting' | 'installing' | 'starting'

const bridge = (
  window as Window & {
    updateCompanion?: {
      ready(): void
      close(): void
      onState(
        callback: (state: {
          error?: string
          color: BrandColor
          stage?: InstallStage
        }) => void
      ): () => void
    }
  }
).updateCompanion
const error = ref('')
const color = ref<BrandColor>('purple')
const stage = ref<InstallStage>('exiting')
const titles = {
  exiting: '正在退出旧版本',
  installing: '正在安装更新',
  starting: '正在启动影盒',
}
const hints = {
  exiting: '正在保存状态并关闭旧版本，请稍候',
  installing: '完成后会自动打开影盒，请勿关闭电脑',
  starting: '安装已完成，正在打开新版影盒',
}
const unsubscribe = bridge?.onState(state => {
  error.value = state.error ?? ''
  color.value = state.color
  stage.value = state.stage ?? 'exiting'
})
onBeforeUnmount(() => unsubscribe?.())
onMounted(() => bridge?.ready())
</script>

<template>
  <main class="companion yb-glass" role="status">
    <UiBrandLogo class="companion-logo" :color="color" />
    <h1>{{ error ? '更新未完成' : titles[stage] }}</h1>
    <p>{{ error || hints[stage] }}</p>
    <UiButton
      v-if="error"
      class="companion-close"
      label="关闭"
      @click="bridge?.close()"
    />
  </main>
</template>

<style>
html,
body,
#app {
  margin: 0;
  width: 100%;
  height: 100%;
  background: transparent;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.companion {
  --glass-bg: color-mix(in srgb, var(--glass-solid) 88%, transparent);
  --glass-shadow: none;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  overflow: hidden;
  color: var(--text-primary);
  -webkit-app-region: drag;
}
.companion .companion-logo {
  width: 88px;
  height: 88px;
  margin-bottom: var(--space-6);
}
.companion .companion-logo,
.companion .companion-logo .brand-sheen {
  animation-iteration-count: infinite;
}
.companion h1 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.companion p {
  margin: var(--space-3) var(--space-6) var(--space-6);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-align: center;
}
.companion-close {
  -webkit-app-region: no-drag;
}
</style>
