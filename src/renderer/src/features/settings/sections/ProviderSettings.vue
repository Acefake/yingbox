<template>
  <SettingsGroup title="刮削服务">
    <SettingsRow stacked>
      <SettingsRadioList
        v-model="currentProvider"
        label="刮削服务"
        :options="providerOptions"
      />
    </SettingsRow>
    <SettingsRow
      v-if="currentProvider === 'tmdb'"
      title="TMDB Access Token"
      stacked
    >
      <template #description>
        前往
        <a
          href="https://www.themoviedb.org/settings/api"
          target="_blank"
          class="yb-link"
          >TMDB API 设置</a
        >
        获取 Read Access Token
      </template>
      <UiTextarea
        v-model="tmdbAccessToken"
        rows="3"
        class="settings-token"
        aria-label="TMDB Access Token"
        placeholder="输入 TMDB API Read Access Token（必填，无内置默认值）"
      />
      <p v-if="!tmdbAccessToken" class="settings-warn">
        尚未配置 Token，TMDB 搜索与刮削不可用
      </p>
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="后端">
    <SettingsRow title="Go 后端地址">
      <template #description>
        需先在 <code class="settings-code">packages/backend/</code> 目录下启动
        Go 服务
      </template>
      <UiInput
        v-model="goBackendUrl"
        type="text"
        aria-label="Go 后端地址"
        placeholder="http://localhost:31471"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow title="访问密钥">
      <template #description>
        仅当后端设置了 <code class="settings-code">YINGBOX_API_KEY</code>
        时需要；仅本机使用可留空
      </template>
      <UiInput
        v-model="goBackendApiKey"
        type="password"
        autocomplete="off"
        aria-label="访问密钥"
        placeholder="可选"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow title="连接状态" :description="testDescription">
      <UiButton
        size="sm"
        :class="`is-test-${goTestStatus}`"
        :icon="testIcon"
        :label="testLabel"
        :loading="goTestStatus === 'testing'"
        :disabled="!goBackendUrl"
        @click="handleTestGoBackend"
      />
    </SettingsRow>

    <template v-if="currentProvider === 'custom'">
      <SettingsRow title="服务名称">
        <UiInput
          v-model="customProviderName"
          type="text"
          aria-label="服务名称"
          placeholder="例如：我的刮削服务"
          class="settings-field is-inline"
        />
      </SettingsRow>
      <SettingsRow
        title="API 基础 URL"
        description="自定义服务需实现与 TMDB 兼容的接口格式"
      >
        <UiInput
          v-model="customBaseUrl"
          type="text"
          aria-label="API 基础 URL"
          placeholder="https://api.example.com"
          class="settings-field is-inline"
        />
      </SettingsRow>
      <SettingsRow title="API Key">
        <UiInput
          v-model="customApiKey"
          type="password"
          autocomplete="off"
          aria-label="API Key"
          placeholder="输入 API Key"
          class="settings-field is-inline"
        />
      </SettingsRow>
    </template>
  </SettingsGroup>

  <SettingsGroup>
    <SettingsRow title="重置刮削配置" description="清除已保存的服务与后端配置">
      <UiButton size="sm" label="重置" @click="resetProviderConfig" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 服务：刮削服务（TMDB / 自定义）、TMDB Token、Go 后端地址与密钥。
 * 每个字段即改即存（scrape.* / backend.*）。
 */
import { computed, ref, watch } from 'vue'

import { backend } from '@/api/backend'
import type { IconName } from '@/components/ui/icons'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'

import type { SettingValue } from '../../../../../shared/settings/schema'
import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRadioList, {
  type SettingsRadioOption,
} from '../ui/SettingsRadioList.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { resetSettings, useSetting } from '../use-setting'

const providerOptions: SettingsRadioOption<SettingValue<'scrape.provider'>>[] =
  [
    {
      value: 'tmdb',
      label: 'TMDB',
      desc: 'The Movie Database，全球最大的电影数据库',
    },
    { value: 'custom', label: '自定义服务', desc: '接入自己的刮削 API' },
  ]

const currentProvider = useSetting('scrape.provider')
const tmdbAccessToken = useSetting('scrape.tmdbToken')
const customProviderName = useSetting('scrape.customName')
const customBaseUrl = useSetting('scrape.customBaseUrl')
const customApiKey = useSetting('scrape.customApiKey')
const goBackendUrl = useSetting('backend.url')
const goBackendApiKey = useSetting('backend.apiKey')
const goTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')

watch([goBackendUrl, goBackendApiKey], () => {
  goTestStatus.value = 'idle'
})

const resetProviderConfig = (): void => {
  void resetSettings([
    'scrape.provider',
    'scrape.tmdbToken',
    'scrape.customName',
    'scrape.customBaseUrl',
    'scrape.customApiKey',
    'backend.url',
    'backend.apiKey',
  ])
  goTestStatus.value = 'idle'
}

const handleTestGoBackend = async (): Promise<void> => {
  goTestStatus.value = 'testing'
  const ok = await backend.testConnection()
  goTestStatus.value = ok ? 'ok' : 'fail'
}

const testLabel = computed(() => {
  if (goTestStatus.value === 'testing') return '测试中…'
  if (goTestStatus.value === 'ok') return '连接成功'
  if (goTestStatus.value === 'fail') return '连接失败'
  return '测试连接'
})
const testIcon = computed<IconName | undefined>(() => {
  if (goTestStatus.value === 'ok') return 'check'
  if (goTestStatus.value === 'fail') return 'warning'
  return undefined
})
const testDescription = computed(() =>
  goTestStatus.value === 'fail'
    ? '后端不可达，请确认地址与密钥，以及 Go 服务已启动'
    : '保存后可测试后端是否可达'
)
</script>

<style scoped>
.settings-token {
  resize: none;
}
.settings-field.is-inline {
  width: 260px;
  max-width: 100%;
}
.settings-warn {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.settings-code {
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
}
.ui-button.is-test-ok {
  color: var(--success);
}
.ui-button.is-test-fail {
  color: var(--danger);
}
@media (max-width: 720px) {
  .settings-field.is-inline {
    width: 100%;
  }
}
</style>
