<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="mpv-loading"
      popover="manual"
      aria-label="正在打开播放器"
    >
      <div class="mpv-loading-card" role="status" aria-live="polite">
        <DialogTitlebar title="正在打开播放器" icon="play" :closable="false" />
        <div class="mpv-loading-content">
          <span class="mpv-loading-spinner" aria-hidden="true" />
          <div class="mpv-loading-copy">
            <p class="mpv-loading-label">正在准备播放…</p>
            <p v-if="status.title" class="mpv-loading-title">
              {{ status.title }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { onBeforeUnmount, ref, watchPostEffect } from 'vue'
import { useMpvPlayer } from '../composables/use-mpv-player'

const { status } = useMpvPlayer()
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
  flex-direction: column;
  width: min(420px, calc(100vw - 48px));
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}
.mpv-loading-content {
  display: flex;
  align-items: center;
  gap: var(--space-4);

  padding: var(--space-6) var(--space-6_5);

  background: var(--bg-elevated);
  color: var(--text-primary);
}
.mpv-loading-spinner {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border: 3px solid var(--text-tertiary);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: mpv-loading-spin var(--duration-spin) linear infinite;
}
.mpv-loading-copy {
  min-width: 0;
}
.mpv-loading-label {
  margin: 0;
  font-size: var(--text-sm);
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
