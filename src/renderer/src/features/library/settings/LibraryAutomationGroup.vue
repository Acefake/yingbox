<template>
  <SettingsGroup title="自动入库" :footer="AUTOMATION_FOOTER">
    <SettingsRow v-if="libraries.length > 1" title="文件夹">
      <UiSelect
        v-model="selectedId"
        size="sm"
        aria-label="选择要设置的文件夹"
        :options="folderOptions"
      />
    </SettingsRow>
    <template v-if="current">
      <SettingsRow title="存储" :description="storageDescription(current)">
        <UiSegmented
          :model-value="current.automation.storage"
          size="sm"
          label="存储"
          :options="STORAGE_OPTIONS"
          @update:model-value="v => patch({ storage: v })"
        />
      </SettingsRow>
      <SettingsRow title="监控文件夹" description="新文件写完后自动入库">
        <UiSwitch
          :model-value="current.automation.watch"
          label="监控文件夹"
          @update:model-value="v => patch({ watch: v })"
        />
      </SettingsRow>
      <SettingsRow
        title="自动识别"
        :description="autoIdentifyDescription(current)"
      >
        <UiSwitch
          :model-value="current.automation.identify"
          label="自动识别"
          @update:model-value="v => patch({ identify: v })"
        />
      </SettingsRow>
      <SettingsRow title="自动写出 NFO 与图片" description="识别后写到视频旁边">
        <UiSegmented
          :model-value="current.automation.write"
          size="sm"
          label="自动写出 NFO 与图片"
          :options="AUTO_WRITE_OPTIONS"
          @update:model-value="v => patch({ write: v })"
        />
      </SettingsRow>
      <SettingsRow
        title="自动整理"
        description="识别后按模板改名移动，可撤销；还需开启下方「允许整理文件」"
      >
        <UiSwitch
          :model-value="current.automation.organize"
          label="自动整理"
          @update:model-value="v => patch({ organize: v })"
        />
      </SettingsRow>
    </template>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 媒体库设置里的「自动入库」组：按文件夹设置存储（本地盘 / 网盘）、监控、自动识别 / 刮削、自动写出、自动整理
 * （库级自动化，见 shared/library/ipc/contract-library.ts）。多个文件夹时先选文件夹。
 * 桌面端与网页端走同一个 updateLibrary 方法。
 */
import { computed, ref, watch } from 'vue'

import type {
  LibraryAutomation,
  LibraryInfo,
} from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { guarded } from '../shared/guarded'
import {
  AUTO_WRITE_OPTIONS,
  STORAGE_OPTIONS,
  autoIdentifyDescription,
  storageDescription,
} from './settings-rules'

const props = defineProps<{
  libraries: LibraryInfo[]
  update: (
    libraryId: number,
    patch: Partial<LibraryAutomation>
  ) => Promise<void>
}>()

const AUTOMATION_FOOTER =
  '本地盘收不到文件变化通知时（NAS 共享、Docker 挂载）每隔几分钟自动检查一次；网盘只按变更通知或手动扫描入库。正在复制的文件等写完再入库。'

const selectedId = ref<number | null>(props.libraries[0]?.id ?? null)
const current = computed(
  () =>
    props.libraries.find(l => l.id === selectedId.value) ?? props.libraries[0]
)
const folderOptions = computed(() =>
  props.libraries.map(l => ({ value: l.id, label: l.name }))
)

// 选中的文件夹被移除时回到第一个
watch(
  () => props.libraries.map(l => l.id),
  ids => {
    if (selectedId.value === null || !ids.includes(selectedId.value)) {
      selectedId.value = ids[0] ?? null
    }
  }
)

function patch(value: Partial<LibraryAutomation>): void {
  const lib = current.value
  if (!lib) return
  void guarded(() => props.update(lib.id, value))
}
</script>
