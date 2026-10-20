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
        全量扫描逐个检查全部文件，用于只改了文件内容、目录没变化的情况。
      </template>
    </SettingsGroup>

    <!-- 元数据源 -->
    <SettingsGroup title="元数据">
      <SettingsRow title="TMDB 令牌" stacked>
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
          :disabled="!libraries.length || !tokenConfigured"
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
          :disabled="!libraries.length || !tokenConfigured"
          @click="refreshAll"
        />
      </SettingsRow>
    </SettingsGroup>

    <!-- 写出 -->
    <SettingsGroup
      title="写出 NFO 与图片"
      :footer="
        writer.available
          ? 'NFO 与图片写在视频旁边，Kodi、Jellyfin、Emby 可直接读取。'
          : WRITER_UNAVAILABLE
      "
    >
      <SettingsRow title="写出 NFO">
        <UiSwitch
          :model-value="writer.settings.value.nfo.enabled"
          label="写出 NFO"
          :disabled="!writer.available"
          @update:model-value="v => writer.update(s => (s.nfo.enabled = v))"
        />
      </SettingsRow>
      <SettingsRow title="已有 NFO" description="合并会保留你手动改过的字段">
        <UiSegmented
          :model-value="writer.settings.value.nfo.mode"
          size="sm"
          label="已有 NFO 的处理方式"
          :options="NFO_MODE_OPTIONS"
          @update:model-value="v => writer.update(s => (s.nfo.mode = v))"
        />
      </SettingsRow>
      <SettingsRow
        v-for="row in ARTWORK_ROWS"
        :key="row.key"
        :title="row.title"
      >
        <UiSwitch
          :model-value="writer.settings.value.artwork[row.key]"
          :label="row.title"
          :disabled="!writer.available"
          @update:model-value="
            v => writer.update(s => (s.artwork[row.key] = v))
          "
        />
      </SettingsRow>
      <SettingsRow
        title="识别后自动写出"
        description="自动匹配或手动确认后立即写出"
      >
        <UiSwitch
          :model-value="writer.settings.value.autoWriteAfterIdentify"
          label="识别后自动写出"
          :disabled="!writer.available"
          @update:model-value="
            v => writer.update(s => (s.autoWriteAfterIdentify = v))
          "
        />
      </SettingsRow>
    </SettingsGroup>

    <!-- 整理 -->
    <SettingsGroup
      title="整理"
      footer="整理会按模板重命名并移动文件。每次执行前都会先预览，执行后可以撤销。"
    >
      <SettingsRow title="允许整理文件" description="默认关闭">
        <UiSwitch
          :model-value="writer.settings.value.organize.enabled"
          label="允许整理文件"
          :disabled="!writer.available"
          @update:model-value="
            v => writer.update(s => (s.organize.enabled = v))
          "
        />
      </SettingsRow>
      <SettingsRow :title="`${kindLabel}路径模板`" stacked>
        <template #description>
          可用变量：<code class="lib-code">{{ templateVariables }}</code>
        </template>
        <UiInput
          :model-value="templateValue"
          :aria-label="`${kindLabel}路径模板`"
          class="lib-template"
          :disabled="!writer.available"
          @update:model-value="setTemplate"
        />
      </SettingsRow>
      <SettingsRow
        v-for="batch in batches"
        :key="batch.batchId"
        :title="batchTitle(batch)"
        :description="batchDescription(batch)"
      >
        <UiButton
          v-if="batch.state === 'done' || batch.state === 'partial'"
          size="sm"
          variant="plain"
          label="撤销"
          @click="undo(batch.batchId)"
        />
      </SettingsRow>
    </SettingsGroup>
    <p v-if="writer.error.value" class="lib-settings-error">
      {{ writer.error.value }}
    </p>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 媒体库设置（macOS 系统设置式分组）：文件夹管理、TMDB 令牌与识别、写出 NFO 与图片、整理模板。
 * 写出与整理来自 P5 的 writer 接口，不可用时整组置灰并在组尾说明。
 */
import { message } from 'ant-design-vue'
import { computed, ref, shallowRef, watch } from 'vue'

import type {
  LibraryInfo,
  LibraryKind,
} from '../../../../../shared/library/ipc'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsRow from '@/components/settings/SettingsRow.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { confirmDialog } from '@/utils/confirm-dialog'

import { errorText, libraryBridge } from '../api/bridge'
import LibrarySheet from '../shared/LibrarySheet.vue'
import { useLibraries } from '../state/use-libraries'
import {
  WRITER_UNAVAILABLE,
  useWriter,
  useWriterSettings,
} from '../writer/use-writer'
import type {
  OrganizeBatchInfo,
  WriterSettings,
} from '../writer/writer-contract'
import { setTmdbToken } from './provider-token'

const props = defineProps<{ open: boolean; kind: LibraryKind }>()
const emit = defineEmits<{ close: [] }>()

const bridge = libraryBridge()
const kindLabel = computed(() => (props.kind === 'movie' ? '电影' : '剧集'))
const {
  available,
  libraries,
  addFolder: pickFolder,
  removeLibrary,
  scanAll,
  identifyAll: startIdentify,
  refreshAll: startRefresh,
} = useLibraries(props.kind)

// —— 文件夹 ——
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function folderDescription(lib: LibraryInfo): string {
  const scanned = lib.lastScanAt
    ? `上次扫描 ${dateFormat.format(lib.lastScanAt)}`
    : '尚未扫描'
  return `${lib.root} · ${scanned}`
}

async function guarded(
  task: () => Promise<unknown>,
  done?: string
): Promise<void> {
  try {
    await task()
    if (done) message.success(done)
  } catch (error) {
    message.error(errorText(error))
  }
}

function addFolder(): void {
  void guarded(async () => {
    const lib = await pickFolder()
    if (lib) message.success(`已添加「${lib.name}」，正在扫描`)
  })
}

function scan(libraryId: number, full: boolean): void {
  void guarded(() => bridge!.scan({ libraryId, full }), '已开始扫描')
}

function confirmRemove(lib: LibraryInfo): void {
  confirmDialog({
    title: `移除「${lib.name}」？`,
    content: '只从媒体库里移除，不会删除磁盘上的文件。',
    okText: '移除',
    okType: 'danger',
    cancelText: '取消',
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
  !available
    ? '仅桌面版可用'
    : tokenConfigured.value
      ? '已配置'
      : '尚未配置，无法识别'
)

async function loadTokenStatus(): Promise<void> {
  if (!bridge) return
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
    const status = await setTmdbToken(bridge, tokenInput.value)
    tokenConfigured.value = status.tmdb.configured
    tokenInput.value = ''
    message.success('TMDB 令牌已保存')
  } catch (error) {
    message.error(errorText(error))
  } finally {
    tokenSaving.value = false
  }
}

// —— 写出与整理 ——
const writer = useWriterSettings()
const { listBatches, undoOrganize } = useWriter()
const batches = shallowRef<OrganizeBatchInfo[]>([])

const NFO_MODE_OPTIONS: SegmentedOption<'merge' | 'overwrite'>[] = [
  { value: 'merge', label: '合并' },
  { value: 'overwrite', label: '覆盖' },
]

type ArtworkKey = keyof WriterSettings['artwork']
const ARTWORK_ROWS: Array<{ key: ArtworkKey; title: string }> = [
  { key: 'poster', title: '海报' },
  { key: 'fanart', title: '背景图' },
  { key: 'logo', title: '标志' },
  { key: 'seasonArt', title: '季海报与剧集缩略图' },
  { key: 'actors', title: '演员头像' },
  { key: 'legacyNames', title: '兼容旧播放器的文件名' },
]

const templateVariables = computed(() =>
  props.kind === 'movie'
    ? '{title} {originalTitle} {year} {tmdbId} {imdbId} {ext}'
    : '{series} {year} {season:02} {episode:02} {episodeTitle} {tmdbId} {ext}'
)
const templateValue = computed(() =>
  props.kind === 'movie'
    ? writer.settings.value.organize.movieTemplate
    : writer.settings.value.organize.tvTemplate
)

function setTemplate(value: string | number | null | undefined): void {
  const text = String(value ?? '')
  writer.update(s => {
    if (props.kind === 'movie') s.organize.movieTemplate = text
    else s.organize.tvTemplate = text
  })
}

const BATCH_STATE: Record<OrganizeBatchInfo['state'], string> = {
  running: '进行中',
  done: '已完成',
  partial: '部分完成',
  failed: '失败',
  undoing: '撤销中',
  undone: '已撤销',
}

function batchTitle(batch: OrganizeBatchInfo): string {
  return `${dateFormat.format(batch.createdAt)} · ${BATCH_STATE[batch.state]}`
}

function batchDescription(batch: OrganizeBatchInfo): string {
  const failed = batch.failed ? `，${batch.failed} 个失败` : ''
  return `移动 ${batch.moved} / ${batch.total} 个文件${failed}`
}

async function loadBatches(): Promise<void> {
  if (!writer.available) return
  try {
    batches.value = (await listBatches()).slice(0, 5)
  } catch {
    batches.value = []
  }
}

function undo(batchId: number): void {
  void guarded(async () => {
    await undoOrganize(batchId)
    await loadBatches()
  }, '已开始撤销')
}

watch(
  () => props.open,
  open => {
    if (!open) return
    void loadTokenStatus()
    void loadBatches()
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
.lib-template {
  font-family: var(--font-mono);
}
.lib-code {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
}
.lib-settings-error {
  margin: var(--space-4) 0 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
</style>
