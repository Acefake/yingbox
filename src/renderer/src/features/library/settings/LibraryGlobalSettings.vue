<template>
  <LibraryFolderSettings section="movie">
    <template #remote>
      <WebDavGroup v-if="webdavAvailable" :jav="adultMode" />
      <Pan115LibraryGroup v-if="isWeb" />
    </template>
  </LibraryFolderSettings>
  <SettingsGroup v-if="showAi" title="识别">
    <AiScrapeSettingRow />
  </SettingsGroup>
  <WriterSettingsGroups />
  <LibraryNotifyGroup v-if="showNotify" />
  <ProgressSyncGroup v-if="showProgressSync" />
  <LibraryFolderSettings v-if="adultMode" section="jav" />
</template>

<script setup lang="ts">
/**
 * 「设置 → 媒体库」：唯一的媒体库设置入口（片库页工具栏的设置按钮也打开这里）。
 * 依次是普通片库的文件夹（电影 / 剧集 / 动漫 / 综艺 / 纪录片共用）与远程源、识别、写出与整理、
 * 通知与进度同步；成人模式下最后是番号库的文件夹与番号站点设置。
 */
import { SettingsGroup, useSetting } from '@/features/settings'
import { aiAvailable } from '@/features/ai'
import { isWebRuntime } from '@/services/library-server'

import { usesLibraryServer } from '../api/bridge'
import AiScrapeSettingRow from '../ai-scrape/AiScrapeSettingRow.vue'
import WebDavGroup from '../webdav/WebDavGroup.vue'
import { webdavApi } from '../webdav/webdav-api'
import LibraryFolderSettings from './LibraryFolderSettings.vue'
import LibraryNotifyGroup from './LibraryNotifyGroup.vue'
import Pan115LibraryGroup from './Pan115LibraryGroup.vue'
import ProgressSyncGroup from './ProgressSyncGroup.vue'
import WriterSettingsGroups from './WriterSettingsGroups.vue'

const adultMode = useSetting('app.adultMode')
const isWeb = isWebRuntime()
/** WebDAV / Alist 源在桌面端主进程里，网页端没有。 */
const webdavAvailable = Boolean(webdavApi())
const desktop = !usesLibraryServer()
const showAi = desktop && aiAvailable()
const showNotify = desktop && Boolean(window.api?.libraryNotify)
const showProgressSync = desktop && Boolean(window.api?.progressSync)
</script>
