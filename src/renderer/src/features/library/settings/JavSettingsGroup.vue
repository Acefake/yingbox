<template>
  <SettingsGroup
    title="番号站点"
    footer="番号文件夹按文件名里的番号刮削。同一字段先取排在前面的站点；关掉的站点不再访问。"
  >
    <SettingsRow
      v-for="row in rows"
      :key="row.id"
      :title="`${row.rank}. ${row.name}`"
      :description="row.description"
    >
      <UiIconButton
        icon="chevronUp"
        size="sm"
        :label="`${row.name} 优先级提前`"
        :disabled="!row.canUp || saving"
        @click="save(moveJavSite(settings, row.id, -1))"
      />
      <UiIconButton
        icon="chevronDown"
        size="sm"
        :label="`${row.name} 优先级推后`"
        :disabled="!row.canDown || saving"
        @click="save(moveJavSite(settings, row.id, 1))"
      />
      <UiSwitch
        :model-value="row.enabled"
        :label="`启用 ${row.name}`"
        :disabled="saving"
        @update:model-value="v => save(toggleJavSite(settings, row.id, v))"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 番号站点设置：开关与优先级（上下移动），走 window.api.library.jav。
 * 只在有番号文件夹时显示（见 LibraryGlobalSettings）。
 */
import { toast } from '@/components/ui'
import { computed, ref, watch } from 'vue'

import {
  DEFAULT_JAV_SETTINGS,
  type JavSettings,
} from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { javSiteRows, moveJavSite, toggleJavSite } from './jav-rules'

const props = defineProps<{ open: boolean }>()

const bridge = libraryBridge()
const settings = ref<JavSettings>(structuredClone(DEFAULT_JAV_SETTINGS))
const saving = ref(false)
const rows = computed(() => javSiteRows(settings.value))

async function load(): Promise<void> {
  if (!bridge) return
  try {
    settings.value = await bridge.jav.getSettings()
  } catch (error) {
    toast.error(errorText(error))
  }
}

async function save(next: JavSettings): Promise<void> {
  if (!bridge || next === settings.value) return
  const previous = settings.value
  settings.value = next
  saving.value = true
  try {
    settings.value = await bridge.jav.setSettings(next)
  } catch (error) {
    settings.value = previous
    toast.error(errorText(error))
  } finally {
    saving.value = false
  }
}

watch(
  () => props.open,
  open => {
    if (open) void load()
  },
  { immediate: true }
)
</script>
