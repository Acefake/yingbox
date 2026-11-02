<template>
  <Teleport to="body">
    <div v-if="update.dialogOpen.value" class="update-backdrop" />
    <div v-if="update.dialogOpen.value" class="update-layer">
      <section
        ref="frame"
        class="update-dialog yb-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        tabindex="-1"
        @keydown="trapTab"
      >
        <div class="update-top">
          <span class="update-icon"><UiIcon name="download" size="lg" /></span>
          <UiIconButton icon="close" label="关闭" @click="close" />
        </div>
        <h2 id="update-title">
          {{
            update.status.value === 'downloaded' ? '更新已下载' : '发现新版本'
          }}
        </h2>
        <p class="update-version">
          影盒 {{ update.version.value
          }}<template v-if="update.currentVersion.value">
            · 当前版本 {{ update.currentVersion.value }}</template
          >
        </p>
        <div class="update-content">
          <h3>本次更新</h3>
          <p class="update-notes custom-scrollbar">
            {{ update.notes.value || '此版本暂无更新说明。' }}
          </p>
        </div>
        <p
          v-if="update.status.value === 'downloading'"
          class="update-hint"
          role="status"
        >
          正在下载更新 {{ update.progress.value.toFixed(1) }}%
        </p>
        <p
          v-else-if="update.status.value === 'error'"
          class="update-hint"
          role="alert"
        >
          {{ update.message.value }}
        </p>
        <p v-else class="update-hint">
          下载完成后，可以选择合适的时间重启安装。
        </p>
        <div class="update-actions">
          <UiButton label="稍后再说" variant="glass" @click="close" />
          <UiButton
            v-if="update.status.value !== 'error'"
            :label="
              update.status.value === 'downloaded' ? '重启安装' : '下载更新'
            "
            variant="primary"
            :loading="update.busy.value"
            @click="update.runAction"
          />
          <UiButton
            v-else
            label="重新检查"
            variant="primary"
            @click="update.runAction"
          />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useUpdateStatus } from './use-update-status'

const update = useUpdateStatus()
const frame = ref<HTMLElement | null>(null)
const close = (): void => {
  update.dialogOpen.value = false
}
useEscapeLayer(() => update.dialogOpen.value, close)
const trapTab = useModalFocus(frame, () => update.dialogOpen.value)
</script>

<style scoped>
.update-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  background: var(--overlay-scrim-soft);
}
.update-layer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-dialog) + 1);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  pointer-events: none;
}
.update-dialog {
  width: min(464px, 100%);
  max-height: calc(100vh - var(--space-8));
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  color: var(--text-primary);
  pointer-events: auto;
  outline: none;
  display: flex;
  flex-direction: column;
}
.update-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.update-icon {
  display: grid;
  place-items: center;
  width: var(--control-height-lg);
  height: var(--control-height-lg);
  border-radius: var(--radius-md);
  background: var(--bg-active);
}
h2 {
  margin: var(--space-5) 0 var(--space-1);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.update-version,
.update-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
.update-content {
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: var(--space-5) 0;
  padding-top: var(--space-5);
  border-top: 1px solid var(--separator);
}
h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}
.update-notes {
  margin: 0;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.update-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
.update-actions > * {
  flex: 1 1 0;
  min-width: 0;
}
</style>
