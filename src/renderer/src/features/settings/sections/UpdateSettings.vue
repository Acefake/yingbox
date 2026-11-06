<template>
  <SettingsGroup>
    <SettingsRow
      title="当前版本"
      :description="
        update.currentVersion.value
          ? `影盒 ${update.currentVersion.value}`
          : '正在读取版本信息'
      "
    />
    <SettingsRow
      :title="update.title.value"
      :description="update.message.value"
    >
      <UiButton
        v-if="update.action.value"
        size="sm"
        :variant="isInstallStep ? 'primary' : 'secondary'"
        :label="update.action.value"
        :loading="update.busy.value || update.installing.value"
        @click="onAction"
      />
    </SettingsRow>
    <SettingsRow
      title="自动下载更新"
      description="发现新版本后在后台下载，下载好后可一键更新并重启；退出应用时也会顺带装上"
    >
      <UiSwitch v-model="autoDownload" label="自动下载更新" />
    </SettingsRow>
    <SettingsRow
      v-if="showNotes"
      title="本次更新"
      :description="update.notes.value"
    />
    <SettingsRow
      title="手动下载"
      description="应用内更新失败时，可以到发布页手动下载安装包"
    >
      <UiButton size="sm" label="打开发布页" @click="openReleasePage" />
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
 * 设置 · 软件更新。状态来自全局共享的 useUpdateStatus（设置面板创建时就开始订阅），
 * 这里只负责展示和触发「检查 / 下载 / 重启安装」。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { toast } from '@/components/ui'
import { RELEASE_PAGE_URL } from '../../../../../shared/desktop-update'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'
import { useUpdateStatus } from '../use-update-status'

const update = useUpdateStatus()
const autoDownload = useSetting('update.autoDownload')
const onAction = (): void => void update.runAction()

/** 应用内更新走不通时的手动下载入口 */
async function openReleasePage(): Promise<void> {
  const result = await window.api.shell.openExternal(RELEASE_PAGE_URL)
  if (!result.success)
    toast.error(`打开发布页失败：${result.error ?? '未知错误'}`)
}

/** 有新版本时展示发布说明 */
const showNotes = computed(
  () =>
    Boolean(update.notes.value) &&
    (update.status.value === 'available' ||
      update.status.value === 'downloaded')
)

/** 有新版本可下载 / 可安装时，这是本区唯一的主操作 */
const isInstallStep = computed(
  () =>
    update.status.value === 'available' || update.status.value === 'downloaded'
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
