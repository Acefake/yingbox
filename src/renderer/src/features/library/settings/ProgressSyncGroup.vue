<template>
  <SettingsGroup title="观看进度同步" :footer="SYNC_FOOTER">
    <SettingsRow
      title="片库服务地址"
      description="NAS 上的片库服务，留空不同步"
      stacked
    >
      <UiInput
        v-model="serverInput"
        aria-label="片库服务地址"
        placeholder="例如 http://192.168.1.10:31480"
        @change="saveServer"
      />
    </SettingsRow>
    <template v-if="server">
      <SettingsRow
        title="访问令牌"
        :description="tokenConfigured ? '已设置' : '片库服务的令牌'"
        stacked
      >
        <UiInput
          v-model="tokenInput"
          type="password"
          aria-label="访问令牌"
          :placeholder="tokenConfigured ? '已设置，输入新令牌替换' : '粘贴令牌'"
          @change="saveToken"
        />
      </SettingsRow>
      <SettingsRow title="同步状态" :description="statusText">
        <UiButton
          size="sm"
          label="立即同步"
          :loading="status.syncing"
          @click="syncNow"
        />
      </SettingsRow>
    </template>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 观看进度与片库服务（网页 / NAS 版）同步：地址是普通设置 library.progressServer，令牌是密钥
 * library.progressServerToken（只写不读），同步由主进程定时跑（src/main/library/progress-sync），
 * 状态与「立即同步」走 window.api.progressSync。只在桌面端显示（见 LibrarySettings）。
 */
import { toast } from '@/components/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ProgressSyncStatus } from '../../../../../shared/contract/progress-sync'
import {
  SettingsGroup,
  SettingsRow,
  setSetting,
  useSetting,
} from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { errorText } from '../api/bridge'
import { syncStatusText } from './progress-sync-rules'

const SYNC_FOOTER =
  '桌面端和 NAS 各记一份观看进度，每 3 分钟按最后观看时间合并一次，同一时间以 NAS 为准。两边的条目按 TMDB 编号或文件指纹对上。'
const TOKEN_KEY = 'library.progressServerToken'

const api = window.api!.progressSync
const settings = window.api!.settings
const server = useSetting('library.progressServer')
const serverInput = ref(server.value)
watch(server, value => (serverInput.value = value))
const tokenInput = ref('')
const tokenConfigured = ref(settings.snapshot().secrets[TOKEN_KEY])
settings.onSecretChanged(change => {
  if (change.key === TOKEN_KEY) tokenConfigured.value = change.configured
})

const status = ref<ProgressSyncStatus>({
  configured: false,
  syncing: false,
  lastSyncAt: null,
  error: null,
  pulled: 0,
  pushed: 0,
})
const statusText = computed(() => syncStatusText(status.value, Date.now()))
api.onChanged(next => (status.value = next))
onBeforeUnmount(() => api.offChanged())
void api.status().then(next => (status.value = next))

async function saveServer(): Promise<void> {
  try {
    await setSetting('library.progressServer', serverInput.value.trim())
  } catch {
    toast.error('地址不合法')
    serverInput.value = server.value
  }
}

async function saveToken(): Promise<void> {
  const value = tokenInput.value.trim()
  if (!value) return
  try {
    await settings.setSecret(TOKEN_KEY, value)
    tokenInput.value = ''
    toast.success('已保存令牌')
  } catch (error) {
    toast.error(errorText(error))
  }
}

async function syncNow(): Promise<void> {
  status.value = await api.syncNow()
  if (status.value.error) toast.error(status.value.error)
}
</script>
