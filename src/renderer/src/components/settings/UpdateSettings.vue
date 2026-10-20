<template>
  <SettingsGroup>
    <SettingsRow
      :title="update.title.value"
      :description="update.message.value"
    >
      <UiButton
        v-if="update.action.value"
        size="sm"
        :variant="isInstallStep ? 'primary' : 'secondary'"
        :label="update.action.value"
        :disabled="update.busy.value"
        @click="update.runAction"
      />
    </SettingsRow>
    <SettingsRow v-if="update.status.value === 'downloading'">
      <div
        class="update-progress"
        role="progressbar"
        aria-label="下载进度"
        :aria-valuenow="Math.round(update.progress.value)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="update-progress-bar"
          :style="{ width: `${update.progress.value}%` }"
        />
      </div>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 软件更新。状态由 SettingsPanel 里常驻的 useUpdateStatus 提供，
 * 这里只负责展示和触发「检查 / 下载 / 重启安装」。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'
import type { UpdateState } from './use-update-status'

const props = defineProps<{ update: UpdateState }>()

/** 有新版本可下载 / 可安装时，这是本区唯一的主操作 */
const isInstallStep = computed(
  () =>
    props.update.status.value === 'available' ||
    props.update.status.value === 'downloaded'
)
</script>

<style scoped>
.update-progress {
  flex: 1;
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.update-progress-bar {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--accent);
  transition: width var(--duration-slow) var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .update-progress-bar {
    transition: none;
  }
}
</style>
