<template>
  <Teleport to="body">
    <dialog
      ref="overlay"
      class="mpv-loading"
      aria-label="正在打开播放器"
      @cancel.prevent
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
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { onBeforeUnmount, ref, watchPostEffect } from 'vue'
import { useMpvPlayer } from '@/composables/use-mpv-player'

const { status } = useMpvPlayer()
const overlay = ref<HTMLDialogElement | null>(null)

// Native dialogs occupy the top layer, above page overlays regardless of z-index.
watchPostEffect(() => {
  const dialog = overlay.value
  if (!dialog) return
  if (status.value.loading && !dialog.open) dialog.showModal()
  else if (!status.value.loading && dialog.open) dialog.close()
})
onBeforeUnmount(() => overlay.value?.close())
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
.mpv-loading[open] {
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
