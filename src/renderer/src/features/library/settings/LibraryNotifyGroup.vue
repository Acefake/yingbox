<template>
  <SettingsGroup title="网盘变更通知" :footer="NOTIFY_FOOTER">
    <SettingsRow
      title="接收变更通知"
      description="网盘文件夹按通知里的目录增量扫描"
    >
      <UiSwitch v-model="enabled" label="接收变更通知" />
    </SettingsRow>
    <template v-if="enabled">
      <SettingsRow title="通知地址" :description="addressText">
        <UiButton
          size="sm"
          label="复制"
          :disabled="!status.url"
          @click="copy"
        />
        <UiButton
          size="sm"
          variant="plain"
          label="换令牌"
          :loading="resetting"
          @click="reset"
        />
      </SettingsRow>
      <SettingsRow
        title="允许局域网访问"
        description="CloudDrive2 不在这台电脑上时打开"
      >
        <UiSwitch v-model="lan" label="允许局域网访问" />
      </SettingsRow>
      <SettingsRow
        title="挂载目录"
        description="可选，CloudDrive2 在本机的挂载目录"
        stacked
      >
        <UiInput
          v-model="mountInput"
          aria-label="挂载目录"
          placeholder="例如 D:\CloudDrive"
          @change="saveMountRoot"
        />
      </SettingsRow>
    </template>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 网盘变更通知（主进程本地 HTTP 端点，见 src/main/library/notify）：开关、地址（令牌打码，复制完整地址）、
 * 换令牌、局域网访问、挂载目录。开关等是普通设置 library.notify.*，状态走 window.api.libraryNotify。
 * 只在桌面端显示（见 LibraryGlobalSettings）。
 */
import { toast } from '@/components/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { LibraryNotifyStatus } from '../../../../../shared/contract/library-notify'
import {
  SettingsGroup,
  SettingsRow,
  setSetting,
  useSetting,
} from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { errorText } from '../api/bridge'
import { notifyAddressText } from './notify-rules'

const NOTIFY_FOOTER =
  '在 CloudDrive2「设置 → Webhook」里把 file_system_watcher 的 url 换成通知地址。通知里的路径会自动对应到库文件夹，对不上时填挂载目录。'

const api = window.api!.libraryNotify
const enabled = useSetting('library.notify.enabled')
const lan = useSetting('library.notify.lan')
const mountRoot = useSetting('library.notify.mountRoot')
const mountInput = ref(mountRoot.value)
watch(mountRoot, value => (mountInput.value = value))

const status = ref<LibraryNotifyStatus>({
  running: false,
  url: null,
  error: null,
})
const addressText = computed(() => notifyAddressText(status.value))
const resetting = ref(false)

api.onChanged(next => (status.value = next))
onBeforeUnmount(() => api.offChanged())
void api.status().then(next => (status.value = next))

async function copy(): Promise<void> {
  if (!status.value.url) return
  try {
    await navigator.clipboard.writeText(status.value.url)
    toast.success('已复制通知地址')
  } catch (error) {
    toast.error(errorText(error))
  }
}

async function reset(): Promise<void> {
  resetting.value = true
  try {
    status.value = await api.resetToken()
    toast.success('已换新令牌，记得更新 CloudDrive2 里的地址')
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    resetting.value = false
  }
}

async function saveMountRoot(): Promise<void> {
  try {
    await setSetting('library.notify.mountRoot', mountInput.value.trim())
  } catch {
    toast.error('挂载目录要填本机绝对路径')
    mountInput.value = mountRoot.value
  }
}
</script>
