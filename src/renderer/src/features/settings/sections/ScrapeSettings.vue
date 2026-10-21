<template>
  <SettingsGroup>
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
 * 设置 · 刮削：TMDB 元数据语言（scrape.metadataLanguage）。
 */
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

const metadataLanguageOptions: SegmentedOption[] = [
  { value: 'zh-CN', label: '中文简体' },
  { value: 'zh-TW', label: '中文繁體' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]

const metadataLanguage = useSetting('scrape.metadataLanguage')
</script>
