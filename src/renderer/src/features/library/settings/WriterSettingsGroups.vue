<template>
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
    <SettingsRow v-for="row in ARTWORK_ROWS" :key="row.key" :title="row.title">
      <UiSwitch
        :model-value="writer.settings.value.artwork[row.key]"
        :label="row.title"
        :disabled="!writer.available"
        @update:model-value="v => writer.update(s => (s.artwork[row.key] = v))"
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
        @update:model-value="v => writer.update(s => (s.organize.enabled = v))"
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
        :invalid="Boolean(templateError)"
        :disabled="!writer.available"
        @update:model-value="setTemplate"
      />
      <p v-if="templateError" class="lib-template-error">
        {{ templateError }}
      </p>
    </SettingsRow>
    <SettingsRow
      v-for="batch in batches"
      :key="batch.batchId"
      :title="batchTitle(batch)"
      :description="batchDescription(batch)"
    >
      <UiButton
        v-if="showUndo(batch.state)"
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
</template>

<script setup lang="ts">
/**
 * 媒体库设置里的「写出 NFO 与图片」与「整理」两组：开关、已有 NFO 处理方式、图片项、
 * 路径模板（逐字校验）、最近的整理批次与撤销。不可用（网页版）时整组置灰并在组尾说明。
 */
import { computed, ref, shallowRef, watch } from 'vue'

import type {
  LibraryKind,
  OrganizeBatchInfo,
} from '../../../../../shared/library/ipc'
import { validateTemplate } from '../../../../../shared/library/writer'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { guarded } from '../shared/guarded'
import {
  WRITER_UNAVAILABLE,
  useWriter,
  useWriterSettings,
} from '../writer/use-writer'
import {
  ARTWORK_ROWS,
  NFO_MODE_OPTIONS,
  RECENT_BATCHES,
  batchDescription,
  batchTitle,
  showUndo,
  templateOf,
  templateVariablesFor,
} from './settings-rules'

const props = defineProps<{
  /** 设置面板是否打开（打开时刷新批次列表）。 */
  open: boolean
  kind: LibraryKind
  kindLabel: string
}>()

const writer = useWriterSettings()
const { listBatches, undoOrganize } = useWriter()
const batches = shallowRef<OrganizeBatchInfo[]>([])

const templateVariables = computed(() => templateVariablesFor(props.kind))
const templateError = computed(() =>
  validateTemplate(templateValue.value, props.kind)
)
const templateValue = computed(
  () => templateDraft.value ?? templateOf(writer.settings.value, props.kind)
)
/** 模板逐字编辑：不合法时只在界面上提示，不下发（引擎也会拒绝）。 */
const templateDraft = ref<string | null>(null)

function setTemplate(value: string | number | null | undefined): void {
  const text = String(value ?? '')
  templateDraft.value = text
  if (validateTemplate(text, props.kind)) return
  templateDraft.value = null
  writer.update(s => {
    if (props.kind === 'movie') s.organize.movieTemplate = text
    else s.organize.tvTemplate = text
  })
}

async function loadBatches(): Promise<void> {
  if (!writer.available) return
  try {
    batches.value = (await listBatches()).slice(0, RECENT_BATCHES)
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
    if (open) void loadBatches()
  },
  { immediate: true }
)
</script>

<style scoped>
.lib-template {
  font-family: var(--font-mono);
}
.lib-template-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
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
