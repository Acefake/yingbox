<template>
  <!-- 文件夹 -->
  <SettingsGroup :title="isJav ? '番号文件夹' : '文件夹'">
    <SettingsRow
      v-for="lib in libraries"
      :key="lib.id"
      :title="lib.name"
      :description="folderDescription(lib)"
    >
      <UiButton
        v-if="!isJav && !lib.mixed"
        size="sm"
        label="自动识别类型"
        @click="convertMixed(lib)"
      />
      <UiButton
        icon="refresh"
        size="sm"
        label="扫描"
        @click="scan(lib.id, false)"
      />
      <UiButton
        icon="trash"
        size="sm"
        variant="danger"
        label="移除文件夹"
        @click="confirmRemove(lib)"
      />
    </SettingsRow>
    <SettingsRow
      v-if="!libraries.length"
      title="还没有文件夹"
      :description="emptyFolderText"
    />
    <SettingsRow>
      <UiButton
        size="sm"
        icon="plus"
        label="添加文件夹…"
        :disabled="!available"
        @click="addFolder"
      />
      <UiButton
        size="sm"
        variant="plain"
        label="全量扫描"
        :disabled="!libraries.length"
        @click="scanAll(true)"
      />
    </SettingsRow>
    <template #footer>
      {{ folderFooter }}
    </template>
  </SettingsGroup>

  <LibraryAutomationGroup
    v-if="libraries.length"
    :libraries="libraries"
    :update="updateAutomation"
  />

  <slot name="remote" />

  <!-- 元数据源 -->
  <SettingsGroup :title="isJav ? '番号识别' : '元数据'">
    <SettingsRow title="识别全部" description="识别还没匹配的条目">
      <UiButton
        size="sm"
        label="开始识别"
        :disabled="!canIdentify"
        @click="identifyAll(false)"
      />
    </SettingsRow>
    <SettingsRow
      title="重新获取全部元数据"
      description="已匹配的条目重新拉取简介、演职员与图片，不改变匹配"
    >
      <UiButton
        size="sm"
        label="刷新"
        :disabled="!canIdentify"
        @click="refreshAll"
      />
    </SettingsRow>
  </SettingsGroup>

  <!-- 番号站点、站点凭据、演员资料来源只属于番号库 -->
  <template v-if="isJav">
    <JavSettingsGroup open />
    <JavCredentialsGroup open />
    <ActorSourcesGroup open />
  </template>
</template>

<script setup lang="ts">
/**
 * 「设置 → 媒体库」里的一组文件夹设置（见 LibraryGlobalSettings），按库来源显示：
 * - 普通片库（section="movie"）：电影 / 剧集 / 动漫 / 综艺 / 纪录片共用的文件夹（自动识别电影或剧集，
 *   再按类型分页）、自动入库、远程源（remote 插槽）与识别；
 * - 番号库（section="jav"，成人模式）：番号文件夹、自动入库、识别（不需要 TMDB 令牌）、番号站点、
 *   站点凭据、演员资料来源。
 */
import { confirmDialog, toast } from '@/components/ui'
import { computed, onMounted, ref } from 'vue'

import type { LibraryInfo } from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'

import { libraryBridge } from '../api/bridge'
import { guarded } from '../shared/guarded'
import type { LibrarySection } from '../state/library-section'
import { useLibraries } from '../state/use-libraries'

import ActorSourcesGroup from './ActorSourcesGroup.vue'
import JavCredentialsGroup from './JavCredentialsGroup.vue'
import JavSettingsGroup from './JavSettingsGroup.vue'
import LibraryAutomationGroup from './LibraryAutomationGroup.vue'
import { folderDescription } from './settings-rules'

const props = defineProps<{
  section: Extract<LibrarySection, 'movie' | 'jav'>
}>()

const bridge = libraryBridge()
// 来源在组件生命周期内不变
const isJav = props.section === 'jav'
const {
  available,
  libraries,
  addFolder: pickFolder,
  removeLibrary,
  updateAutomation,
  scanAll,
  identifyAll: startIdentify,
  refreshAll: startRefresh,
} = useLibraries(props.section)

/** 番号库识别走番号站点，不需要 TMDB 令牌。 */
const canIdentify = computed(
  () => libraries.value.length > 0 && (isJav || tokenConfigured.value)
)

const folderFooter = isJav
  ? '番号文件夹按文件名里的番号（如 ABC-123）刮削番号站点，不需要 TMDB 令牌。全量扫描逐个检查全部文件。'
  : '文件夹里的影片自动识别为电影或剧集，再按类型分到动漫、综艺、纪录片页面。全量扫描逐个检查全部文件，用于只改了文件内容、目录没变化的情况。'

const emptyFolderText = isJav
  ? '添加存放番号的文件夹后，会自动扫描并识别'
  : '添加存放影片的文件夹后，会自动扫描，并分到电影、剧集、动漫、综艺、纪录片'

function addFolder(): void {
  void guarded(async () => {
    const lib = await pickFolder()
    if (lib) toast.success(`已添加「${lib.name}」，正在扫描`)
  })
}

function scan(libraryId: number, full: boolean): void {
  void guarded(() => bridge!.scan({ libraryId, full }), '已开始扫描')
}

function convertMixed(lib: LibraryInfo): void {
  void confirmDialog({
    title: `让「${lib.name}」自动识别电影和剧集？`,
    content:
      '现有条目保留原分类、匹配和观看进度。之后添加的文件会自动识别为电影或剧集。',
    okText: '自动识别',
    onOk: () =>
      guarded(async () => {
        await bridge!.updateLibrary({ libraryId: lib.id, mixed: true })
      }, '已开启自动识别'),
  })
}

function confirmRemove(lib: LibraryInfo): void {
  void confirmDialog({
    title: `移除「${lib.name}」？`,
    content: '文件夹里的影片会从各个页面移除，不会删除磁盘或网盘上的文件。',
    okText: '移除',
    danger: true,
    onOk: () => guarded(() => removeLibrary(lib.id), '已移除'),
  })
}

function identifyAll(force: boolean): void {
  void guarded(() => startIdentify(force), '已开始识别')
}

function refreshAll(): void {
  void guarded(() => startRefresh(), '已开始重新获取元数据')
}

// —— TMDB 令牌 ——
const tokenConfigured = ref(false)

async function loadTokenStatus(): Promise<void> {
  if (!bridge || isJav) return
  try {
    tokenConfigured.value = (await bridge.getProviderStatus()).tmdb.configured
  } catch {
    tokenConfigured.value = false
  }
}

onMounted(() => void loadTokenStatus())
</script>
