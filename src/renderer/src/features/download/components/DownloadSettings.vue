<template>
  <SettingsGroup footer="番号下载的视频保存在这里，每部一个子文件夹。">
    <SettingsRow title="下载目录" stacked>
      <div class="download-dir">
        <UiInput
          :value="label"
          class="download-dir-field"
          aria-label="下载目录"
          :title="label"
          readonly
        />
        <UiIconButton
          icon="folder"
          variant="secondary"
          label="选择下载目录…"
          :disabled="busy"
          @click="pick"
        />
        <UiButton
          v-if="dir"
          size="sm"
          label="默认"
          title="恢复默认下载目录"
          :disabled="busy"
          @click="reset"
        />
      </div>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 下载：下载目录（download.dir）。选择与保存都在主进程，这里只显示当前值和发起操作。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { toast } from '@/components/ui/toast'
import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'

import {
  downloadDirLabel,
  pickDownloadDir,
  resetDownloadDir,
} from '../download-dir'

const dir = useSetting('download.dir')
const label = computed(() => downloadDirLabel(dir.value))
const busy = ref(false)

/** 执行一次目录操作：防重复点击，失败用轻提示说明原因 */
async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    busy.value = false
  }
}

const pick = (): Promise<void> => run(pickDownloadDir)
const reset = (): Promise<void> => run(resetDownloadDir)
</script>

<style scoped>
.download-dir {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.download-dir-field {
  flex: 1;
  min-width: 0;
}
</style>
