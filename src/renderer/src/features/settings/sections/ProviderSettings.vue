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

  <SettingsGroup v-if="currentProvider === 'custom'" title="自定义服务">
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
  </SettingsGroup>

  <SettingsGroup>
    <SettingsRow title="重置刮削配置" description="清除已保存的服务配置">
      <UiButton size="sm" label="重置" @click="resetProviderConfig" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 服务：刮削服务（TMDB / 自定义）与 TMDB Token。每个字段即改即存（scrape.*）。
 */
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

const resetProviderConfig = (): void => {
  void resetSettings([
    'scrape.provider',
    'scrape.tmdbToken',
    'scrape.customName',
    'scrape.customBaseUrl',
    'scrape.customApiKey',
  ])
}
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
@media (max-width: 720px) {
  .settings-field.is-inline {
    width: 100%;
  }
}
</style>
