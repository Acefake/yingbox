<template>
  <LibrarySheet
    :open="open"
    :title="`${kindLabel}库设置`"
    icon="settings"
    @close="emit('close')"
  >
    <!-- 文件夹 -->
    <SettingsGroup :title="`${kindLabel}文件夹`">
      <SettingsRow
        v-for="lib in libraries"
        :key="lib.id"
        :title="lib.name"
        :description="folderDescription(lib)"
      >
        <UiIconButton
          icon="refresh"
          size="sm"
          label="扫描"
          @click="scan(lib.id, false)"
        />
        <UiIconButton
          icon="trash"
          size="sm"
          danger
          label="移除文件夹"
          @click="confirmRemove(lib)"
        />
      </SettingsRow>
      <SettingsRow
        v-if="!libraries.length"
        title="还没有文件夹"
        :description="`添加存放${kindLabel}的文件夹后，会自动扫描并识别`"
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

    <!-- 元数据源 -->
    <SettingsGroup title="元数据">
      <SettingsRow v-if="!isJav" title="TMDB 令牌" stacked>
        <template #description>
          {{ tokenStatusText }}。在
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            class="yb-link"
            >TMDB API 设置</a
          >
          获取 Read Access Token。
        </template>
        <form class="lib-token" @submit.prevent="saveToken">
          <UiInput
            v-model="tokenInput"
            type="password"
            autocomplete="off"
            aria-label="TMDB 令牌"
            :placeholder="
              tokenConfigured
                ? '已配置，输入新令牌可替换'
                : '粘贴 TMDB Read Access Token'
            "
          />
          <UiButton
            type="submit"
            size="sm"
            label="保存"
            :loading="tokenSaving"
            :disabled="!available || !tokenInput.trim()"
          />
        </form>
      </SettingsRow>
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

    <!-- 番号站点、站点凭据、演员资料来源只在番号页 -->
    <template v-if="isJav">
      <JavSettingsGroup :open="open" />
      <JavCredentialsGroup :open="open" />
      <ActorSourcesGroup :open="open" />
    </template>

    <WriterSettingsGroups
      :open="open"
      :kind="spec.kind"
      :kind-label="templateLabel"
    />
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 媒体库设置（macOS 系统设置式分组），按分区显示：
 * - 电影 / 剧集：文件夹、自动入库、TMDB 令牌与识别、写出 NFO 与图片、整理模板；
 * - 番号：文件夹（添加的就是番号库）、自动入库、识别（不需要 TMDB 令牌）、番号站点、站点凭据、
 *   演员资料来源、写出与整理（路径模板与电影共用）。
 * 写出与整理两组在 WriterSettingsGroups，走 window.api.library.writer。
 */
import { confirmDialog, toast } from '@/components/ui'
import { computed, ref, watch } from 'vue'

import type { LibraryInfo } from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { errorText, libraryBridge } from '../api/bridge'
import LibrarySheet from '../shared/LibrarySheet.vue'
import { guarded } from '../shared/guarded'
import { type LibrarySection, SECTIONS } from '../state/library-section'
import { useLibraries } from '../state/use-libraries'
import ActorSourcesGroup from './ActorSourcesGroup.vue'
import JavCredentialsGroup from './JavCredentialsGroup.vue'
import JavSettingsGroup from './JavSettingsGroup.vue'
import LibraryAutomationGroup from './LibraryAutomationGroup.vue'
import WriterSettingsGroups from './WriterSettingsGroups.vue'
import { saveLibraryTmdbToken } from './provider-token'
import { folderDescription, tokenStatus } from './settings-rules'

const props = defineProps<{ open: boolean; section: LibrarySection }>()
const emit = defineEmits<{ close: [] }>()

const bridge = libraryBridge()
// 分区在面板生命周期内不变
const spec = SECTIONS[props.section]
const kindLabel = spec.label
const isJav = props.section === 'jav'
/** 整理路径模板按库类型存：番号库与电影共用电影模板。 */
const templateLabel = isJav ? '电影与番号' : kindLabel
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
  : '全量扫描逐个检查全部文件，用于只改了文件内容、目录没变化的情况。'

function addFolder(): void {
  void guarded(async () => {
    const lib = await pickFolder()
    if (lib) toast.success(`已添加「${lib.name}」，正在扫描`)
  })
}

function scan(libraryId: number, full: boolean): void {
  void guarded(() => bridge!.scan({ libraryId, full }), '已开始扫描')
}

function confirmRemove(lib: LibraryInfo): void {
  void confirmDialog({
    title: `移除「${lib.name}」？`,
    content: '只从媒体库里移除，不会删除磁盘上的文件。',
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
const tokenInput = ref('')
const tokenSaving = ref(false)
const tokenStatusText = computed(() =>
  tokenStatus(available, tokenConfigured.value)
)

async function loadTokenStatus(): Promise<void> {
  if (!bridge || isJav) return
  try {
    tokenConfigured.value = (await bridge.getProviderStatus()).tmdb.configured
  } catch {
    tokenConfigured.value = false
  }
}

async function saveToken(): Promise<void> {
  if (!bridge || !tokenInput.value.trim()) return
  tokenSaving.value = true
  try {
    const status = await saveLibraryTmdbToken(bridge, tokenInput.value)
    tokenConfigured.value = status.tmdb.configured
    tokenInput.value = ''
    toast.success('TMDB 令牌已保存')
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    tokenSaving.value = false
  }
}

watch(
  () => props.open,
  open => {
    if (open) void loadTokenStatus()
  },
  { immediate: true }
)
</script>

<style scoped>
.lib-token {
  display: flex;
  gap: var(--space-2);
}
.lib-token > :first-child {
  flex: 1 1 auto;
}
</style>
