<template>
  <SettingsGroup title="连接方式" :footer="scope">
    <SettingsRow
      title="GitHub"
      description="官方优先，连接失败时按列表顺序尝试镜像"
      stacked
    >
      <UiSegmented
        v-model="draft.githubMode"
        label="GitHub 连接方式"
        :options="githubOptions"
      />
    </SettingsRow>
    <SettingsRow
      title="TMDB API"
      description="备用域名保留官方 API 路径；海报图片单独连接"
      stacked
    >
      <UiSegmented
        v-model="draft.tmdbMode"
        label="TMDB 连接方式"
        :options="tmdbOptions"
      />
    </SettingsRow>
  </SettingsGroup>
  <SettingsGroup
    title="GitHub 镜像"
    footer="最多 5 个 HTTPS 地址。自定义镜像用于公开文件，GitHub API 仅使用已验证的 gh-proxy.com。"
  >
    <SettingsRow
      v-for="(mirror, index) in draft.mirrors"
      :key="mirror"
      :title="mirror"
      class="network-endpoint"
      :description="`优先级 ${index + 1}`"
    >
      <UiIconButton
        icon="chevronUp"
        :label="`上移 ${mirror}`"
        :disabled="index === 0"
        @click="move(index)"
      />
      <UiIconButton
        icon="close"
        :label="`移除 ${mirror}`"
        @click="draft.mirrors.splice(index, 1)"
      />
    </SettingsRow>
    <SettingsRow title="添加镜像" stacked>
      <div class="network-add">
        <UiInput
          v-model="address"
          aria-label="镜像地址"
          placeholder="https://example.com/"
        />
        <UiIconButton icon="plus" label="添加镜像" @click="add" />
      </div>
    </SettingsRow>
    <SettingsRow>
      <UiButton
        label="恢复内置地址"
        @click="draft.mirrors = [...BUILTIN_MIRRORS]"
      />
    </SettingsRow>
  </SettingsGroup>
  <SettingsGroup
    title="连接检查"
    footer="检测使用当前草稿，不发送 Token。结果只代表执行检测的设备与当前网络；API 可达不代表令牌有效。"
  >
    <SettingsRow
      title="公开服务检测"
      description="分别检测 GitHub 文件、API、TMDB API 和图片"
    >
      <UiButton label="测试连接" :loading="testing" @click="test" />
    </SettingsRow>
    <SettingsRow
      v-for="result in results"
      :key="result.endpoint"
      :title="result.purpose"
      class="network-endpoint"
      :description="`${result.endpoint} · ${result.detail}`"
    >
      <span :class="result.ok ? 'network-ok' : 'network-failed'">{{
        result.ok ? '通过' : '未通过'
      }}</span>
    </SettingsRow>
    <SettingsRow v-if="checkedAt" :description="`检测时间：${checkedAt}`" />
  </SettingsGroup>
  <div class="network-actions">
    <p role="status">{{ message }}</p>
    <UiButton
      variant="primary"
      label="保存设置"
      :loading="saving"
      :disabled="!dirty"
      @click="save"
    />
  </div>
</template>

<script setup lang="ts">
/** 网络优化草稿：明确保存，检测不落盘；离开时保护未保存内容。 */
import { computed, onMounted, ref } from 'vue'
import {
  UiButton,
  UiIconButton,
  UiInput,
  UiSegmented,
  confirmDialog,
  toast,
} from '@/components/ui'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import { isWebRuntime, serverFetch } from '@/services/library-server'
import {
  BUILTIN_MIRRORS,
  type NetworkPreferences,
  parseMirror,
} from '../../../../../shared/network/preferences'
import type { NetworkProbeResult } from '../../../../../shared/network/probe'
import { getSetting, setSetting, settingsReady } from '../use-setting'
import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'

const draft = ref<NetworkPreferences>(
  JSON.parse(JSON.stringify(getSetting('network.optimization')))
)
const saved = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
onMounted(async () => {
  await settingsReady
  if (dirty.value) return
  draft.value = JSON.parse(JSON.stringify(getSetting('network.optimization')))
  saved.value = JSON.stringify(draft.value)
})
const address = ref('')
const testing = ref(false)
const saving = ref(false)
const results = ref<NetworkProbeResult[]>([])
const checkedAt = ref('')
const message = ref('')
const scope = isWebRuntime()
  ? '配置保存在 NAS 服务端，检测也由服务端执行。影片播放、115 与局域网连接不受影响。'
  : '配置保存在本机。影片播放、115 与局域网连接不受影响。'
const githubOptions: SegmentedOption[] = [
  { value: 'auto', label: '自动回退' },
  { value: 'direct', label: '仅官方' },
]
const tmdbOptions: SegmentedOption[] = [
  { value: 'auto', label: '自动回退' },
  { value: 'direct', label: '主 API' },
  { value: 'alternate', label: '备用 API' },
]

function add(): void {
  const mirror = parseMirror(address.value)
  if (!mirror)
    return void toast.error('请输入不含账号、端口或查询参数的公网 HTTPS 地址')
  if (draft.value.mirrors.includes(mirror))
    return void toast.info('这个地址已经在列表中')
  if (draft.value.mirrors.length >= 5)
    return void toast.info('最多添加 5 个镜像')
  draft.value.mirrors.push(mirror)
  address.value = ''
}

function move(index: number): void {
  if (index === 0) return
  const list = draft.value.mirrors
  ;[list[index - 1], list[index]] = [list[index], list[index - 1]]
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  const value = JSON.parse(JSON.stringify(draft.value)) as NetworkPreferences
  try {
    await setSetting('network.optimization', value)
    saved.value = JSON.stringify(value)
    message.value = '已保存，新的网络请求使用此配置'
  } catch (error) {
    toast.error(`保存失败：${(error as Error).message}`)
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  if (testing.value) return
  testing.value = true
  const value = JSON.parse(JSON.stringify(draft.value)) as NetworkPreferences
  try {
    if (window.api)
      results.value = await window.api.settings.probeNetwork(value)
    else {
      const response = await serverFetch('/api/network/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      results.value = (await response.json()) as NetworkProbeResult[]
    }
    checkedAt.value = new Date().toLocaleString()
  } catch (error) {
    toast.error(`检测失败：${(error as Error).message}`)
  } finally {
    testing.value = false
  }
}

let leaving: Promise<boolean> | null = null

function canLeave(): boolean | Promise<boolean> {
  if (saving.value) return false
  if (!dirty.value) return true
  leaving ??= confirmDialog({
    title: '放弃未保存的网络设置？',
    content: '本次修改尚未保存。',
    okText: '放弃修改',
  }).finally(() => {
    leaving = null
  })
  return leaving
}

defineExpose({ canLeave })
</script>

<style scoped>
.network-endpoint {
  overflow-wrap: anywhere;
}
.network-add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.network-add > :first-child {
  flex: 1;
  min-width: 0;
}
.network-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-top: var(--space-6);
}
.network-actions p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.network-ok {
  color: var(--success);
  white-space: nowrap;
}
.network-failed {
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
