<template>
  <SettingsGroup v-if="showAi" title="识别">
    <AiScrapeSettingRow />
  </SettingsGroup>
  <WriterSettingsGroups />
  <LibraryNotifyGroup v-if="showNotify" />
  <ProgressSyncGroup v-if="showProgressSync" />
</template>

<script setup lang="ts">
import { SettingsGroup } from '@/features/settings'
import { aiAvailable } from '@/features/ai'

import { usesLibraryServer } from '../api/bridge'
import AiScrapeSettingRow from '../ai-scrape/AiScrapeSettingRow.vue'
import LibraryNotifyGroup from './LibraryNotifyGroup.vue'
import ProgressSyncGroup from './ProgressSyncGroup.vue'
import WriterSettingsGroups from './WriterSettingsGroups.vue'

const desktop = !usesLibraryServer()
const showAi = desktop && aiAvailable()
const showNotify = desktop && Boolean(window.api?.libraryNotify)
const showProgressSync = desktop && Boolean(window.api?.progressSync)
</script>
