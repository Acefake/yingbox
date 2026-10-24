<template>
  <SettingsRow title="AI 识别兜底" :description="aiScrapeDescription(ready)">
    <UiSwitch
      v-model="enabled"
      label="AI 识别兜底"
      :disabled="!ready && !enabled"
    />
  </SettingsRow>
</template>

<script setup lang="ts">
/**
 * 媒体库设置「元数据」组里的「AI 识别兜底」开关（设置项 ai.scrapeFallback，默认关）。
 * AI 还没配置好时不能打开；已打开的仍可关掉。
 */
import { computed } from 'vue'

import { aiKeyConfigured } from '@/features/ai'
import { SettingsRow, useSetting } from '@/features/settings'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { aiScrapeDescription, aiScrapeReady } from './ai-scrape-rules'

const enabled = useSetting('ai.scrapeFallback')
const provider = useSetting('ai.provider')
const ready = computed(() =>
  aiScrapeReady(provider.value, aiKeyConfigured(provider.value))
)
</script>
