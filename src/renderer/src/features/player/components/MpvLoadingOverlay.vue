<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="mpv-loading"
      popover="manual"
      aria-label="正在打开播放器"
    >
      <div class="mpv-loading-card yb-glass" role="status" aria-live="polite">
        <UiBrandLogo class="mpv-loading-logo" :color="brandColor" />
        <div class="mpv-loading-copy">
          <p class="mpv-loading-label">正在启动播放器…</p>
          <p v-if="status.title" class="mpv-loading-title">
            {{ status.title }}
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import UiBrandLogo from '@/components/ui/UiBrandLogo.vue'
import { useSetting } from '@/features/settings'
import { onBeforeUnmount, ref, watchPostEffect } from 'vue'
import { useMpvPlayer } from '../composables/use-mpv-player'

const { status } = useMpvPlayer()
const brandColor = useSetting('ui.brandColor')
const overlay = ref<HTMLElement | null>(null)

// 加载提示不需要模态焦点，popover 保持顶层显示而不让整页进入 inert 状态。
watchPostEffect(() => {
  const element = overlay.value
  if (!element) return
  const open = element.matches(':popover-open')
  if (status.value.loading && !open) element.showPopover()
  else if (!status.value.loading && open) element.hidePopover()
})
onBeforeUnmount(() => {
  if (overlay.value?.matches(':popover-open')) overlay.value.hidePopover()
})
</script>

<style scoped>
.mpv-loading {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.mpv-loading:popover-open {
  display: grid;
  place-items: center;
}
.mpv-loading::backdrop {
  background: var(--overlay-scrim-soft);
}
.mpv-loading-card {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  width: min(420px, calc(100vw - 48px));
  padding: var(--space-6) var(--space-7);
  border-radius: var(--radius-xl);
  color: var(--text-primary);
}
/* 品牌标志放大并一直循环（UiBrandLogo 默认只播一次） */
.mpv-loading-card .mpv-loading-logo {
  width: 48px;
  height: 48px;
}
.mpv-loading-card .mpv-loading-logo,
.mpv-loading-card .mpv-loading-logo :deep(.brand-sheen) {
  animation-iteration-count: infinite;
}
.mpv-loading-copy {
  min-width: 0;
}
.mpv-loading-label {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.mpv-loading-title {
  margin: var(--space-2) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes mpv-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
