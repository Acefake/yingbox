<template>
  <SettingsGroup>
    <SettingsRow
      title="并发任务数"
      description="同时进行的刮削任务数量；网络好可调高，遇限流（429）建议调低"
    >
      <UiSegmented
        v-model="scrapeConcurrency"
        size="sm"
        label="并发任务数"
        :options="concurrencyOptions"
      />
    </SettingsRow>
    <SettingsRow
      title="元数据语言"
      description="刮削时从 TMDB 获取的标题、简介、演员等信息的语言"
    >
      <UiSegmented
        v-model="metadataLanguage"
        size="sm"
        label="元数据语言"
        :options="metadataLanguageOptions"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 刮削：并发任务数（scrapeConcurrency）与 TMDB 元数据语言（metadataLanguage）。
 */
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'
import { useStoredSetting } from './use-stored-setting'

const concurrencyOptions: SegmentedOption[] = [
  '1',
  '2',
  '3',
  '4',
  '6',
  '8',
].map(value => ({ value, label: value }))

const metadataLanguageOptions: SegmentedOption[] = [
  { value: 'zh-CN', label: '中文简体' },
  { value: 'zh-TW', label: '中文繁體' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]

const scrapeConcurrency = useStoredSetting('scrapeConcurrency', '3')
const metadataLanguage = useStoredSetting('metadataLanguage', 'zh-CN')
</script>
