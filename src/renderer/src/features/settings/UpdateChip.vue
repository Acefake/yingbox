<template>
  <div
    v-if="visible"
    class="update-chip yb-glass"
    :class="{ 'is-row': found || ready }"
    role="status"
  >
    <template v-if="update.installing.value">
      <span class="update-chip-text">正在重启，安装完成后会自动打开影盒</span>
    </template>
    <template v-else-if="found">
      <span class="update-chip-text"
        >发现新版本 {{ update.version.value }}</span
      >
      <UiButton
        size="sm"
        variant="primary"
        label="下载更新"
        :loading="update.busy.value"
        @click="update.runAction"
      />
    </template>
    <template v-else-if="ready">
      <span class="update-chip-text"
        >影盒 {{ update.version.value }} 已就绪</span
      >
      <UiButton
        size="sm"
        variant="primary"
        label="更新并重启"
        :loading="update.busy.value"
        @click="update.runAction"
      />
    </template>
    <template v-else>
      <span class="update-chip-text">
        正在下载更新 {{ Math.round(update.progress.value) }}%
      </span>
      <div
        class="update-chip-bar"
        role="progressbar"
        aria-label="下载进度"
        :aria-valuenow="Math.round(update.progress.value)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="update-chip-fill"
          :style="{ width: `${update.progress.value}%` }"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 右下角更新条（唯一的更新提示）：关了自动下载时提示「下载更新」，后台下载时显示进度，下载好后给「更新并重启」。
 * 不挡操作；重启时在更新条内提示，直到旧进程退出。只在桌面端出现。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import { useSetting } from './use-setting'
import { useUpdateStatus } from './use-update-status'

const update = useUpdateStatus()
const autoDownload = useSetting('update.autoDownload')
const ready = computed(() => update.status.value === 'downloaded')
/** 发现新版但没开自动下载：等用户点「下载更新」 */
const found = computed(
  () => update.status.value === 'available' && !autoDownload.value
)
const visible = computed(
  () =>
    Boolean(window.api?.update) &&
    (found.value || ready.value || update.status.value === 'downloading')
)
</script>

<style scoped>
.update-chip {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 200px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  color: var(--text-primary);
}
.update-chip:where(.is-row) {
  flex-direction: row;
  align-items: center;
  gap: var(--space-3);
}
.update-chip-text {
  font-size: var(--text-sm);
}
.update-chip-bar {
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-active);
}
.update-chip-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--accent);
  transition: width var(--duration-slow) var(--ease-out);
}
</style>
