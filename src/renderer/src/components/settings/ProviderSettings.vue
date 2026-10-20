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
      <textarea
        v-model="tmdbAccessToken"
        rows="3"
        class="yb-field settings-field resize-none"
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
      <input
        v-model="goBackendUrl"
        type="text"
        aria-label="Go 后端地址"
        placeholder="http://localhost:31471"
        class="yb-field settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow title="访问密钥">
      <template #description>
        仅当后端设置了 <code class="settings-code">YINGBOX_API_KEY</code>
        时需要；仅本机使用可留空
      </template>
      <input
        v-model="goBackendApiKey"
        type="password"
        autocomplete="off"
        aria-label="访问密钥"
        placeholder="可选"
        class="yb-field settings-field is-inline"
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
        <input
          v-model="customProviderName"
          type="text"
          aria-label="服务名称"
          placeholder="例如：我的刮削服务"
          class="yb-field settings-field is-inline"
        />
      </SettingsRow>
      <SettingsRow
        title="API 基础 URL"
        description="自定义服务需实现与 TMDB 兼容的接口格式"
      >
        <input
          v-model="customBaseUrl"
          type="text"
          aria-label="API 基础 URL"
          placeholder="https://api.example.com"
          class="yb-field settings-field is-inline"
        />
      </SettingsRow>
      <SettingsRow title="API Key">
        <input
          v-model="customApiKey"
          type="password"
          autocomplete="off"
          aria-label="API Key"
          placeholder="输入 API Key"
          class="yb-field settings-field is-inline"
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
 *
 * 每个字段变化即通过 saveScrapeProviderConfig 写入 localStorage 的 scrapeProviderConfig；
 * 组件每次挂载（打开此分区）都会重新读取最新配置。
 */
import { computed, ref, watch } from 'vue'

import { backend } from '@/api/backend'
import type { IconName } from '@/components/ui/icons'
import UiButton from '@/components/ui/UiButton.vue'
import {
  type ScrapeProviderType,
  getScrapeProviderConfig,
  saveScrapeProviderConfig,
} from '@/stores/scrape-provider-store'

import SettingsGroup from './SettingsGroup.vue'
import SettingsRadioList, {
  type SettingsRadioOption,
} from './SettingsRadioList.vue'
import SettingsRow from './SettingsRow.vue'

const providerOptions: SettingsRadioOption<ScrapeProviderType>[] = [
  {
    value: 'tmdb',
    label: 'TMDB',
    desc: 'The Movie Database，全球最大的电影数据库',
  },
  { value: 'custom', label: '自定义服务', desc: '接入自己的刮削 API' },
]

const initial = getScrapeProviderConfig()
const currentProvider = ref<ScrapeProviderType>(initial.provider)
const tmdbAccessToken = ref(initial.tmdbAccessToken)
const customProviderName = ref(initial.customProviderName)
const customBaseUrl = ref(initial.customBaseUrl)
const customApiKey = ref(initial.customApiKey)
const goBackendUrl = ref(initial.goBackendUrl || 'http://localhost:31471')
const goBackendApiKey = ref(initial.goBackendApiKey || '')
const goTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')

/** 从 localStorage 重新读取全部字段 */
const loadConfig = (): void => {
  const c = getScrapeProviderConfig()
  currentProvider.value = c.provider
  tmdbAccessToken.value = c.tmdbAccessToken
  customProviderName.value = c.customProviderName
  customBaseUrl.value = c.customBaseUrl
  customApiKey.value = c.customApiKey
  goBackendUrl.value = c.goBackendUrl || 'http://localhost:31471'
  goBackendApiKey.value = c.goBackendApiKey || ''
}

watch(currentProvider, val => saveScrapeProviderConfig({ provider: val }))
watch(tmdbAccessToken, val =>
  saveScrapeProviderConfig({ tmdbAccessToken: val })
)
watch(customProviderName, val =>
  saveScrapeProviderConfig({ customProviderName: val })
)
watch(customBaseUrl, val => saveScrapeProviderConfig({ customBaseUrl: val }))
watch(customApiKey, val => saveScrapeProviderConfig({ customApiKey: val }))
watch(goBackendUrl, val => {
  saveScrapeProviderConfig({ goBackendUrl: val })
  goTestStatus.value = 'idle'
})
watch(goBackendApiKey, val => {
  saveScrapeProviderConfig({ goBackendApiKey: val })
  goTestStatus.value = 'idle'
})

const resetProviderConfig = (): void => {
  localStorage.removeItem('scrapeProviderConfig')
  loadConfig()
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
.settings-field {
  font-size: var(--text-sm);
}
.settings-field.is-inline {
  width: 260px;
  max-width: 100%;
  height: var(--control-height);
  padding-block: 0;
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
