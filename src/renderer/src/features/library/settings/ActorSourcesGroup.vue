<template>
  <SettingsGroup
    title="演员资料"
    footer="番号文件夹的影片识别后，在后台为新出现的演员查头像与资料（不影响影片入库）。同一字段先取排在前面的来源；关掉的来源不再访问。"
  >
    <SettingsRow
      title="自动获取演员资料"
      description="关闭后只在演员详情里手动「重新获取资料」时查询"
    >
      <UiSwitch
        :model-value="settings.autoLookup"
        label="自动获取演员资料"
        :disabled="saving"
        @update:model-value="v => save({ ...settings, autoLookup: v })"
      />
    </SettingsRow>
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
        @click="save(moveActorSource(settings, row.id, -1))"
      />
      <UiIconButton
        icon="chevronDown"
        size="sm"
        :label="`${row.name} 优先级推后`"
        :disabled="!row.canDown || saving"
        @click="save(moveActorSource(settings, row.id, 1))"
      />
      <UiSwitch
        :model-value="row.enabled"
        :label="`启用 ${row.name}`"
        :disabled="saving"
        @update:model-value="v => save(toggleActorSource(settings, row.id, v))"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 演员资料来源设置：自动获取开关、来源开关与优先级（上下移动），走 window.api.library.actors。
 * 只在有番号文件夹时显示（见 LibrarySettings）。
 */
import { toast } from '@/components/ui'
import { computed, ref, watch } from 'vue'

import {
  type ActorSettings,
  DEFAULT_ACTOR_SETTINGS,
} from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import { errorText, libraryBridge } from '../api/bridge'
import {
  actorSourceRows,
  moveActorSource,
  toggleActorSource,
} from './actor-source-rules'

const props = defineProps<{ open: boolean }>()

const bridge = libraryBridge()
const settings = ref<ActorSettings>(structuredClone(DEFAULT_ACTOR_SETTINGS))
const saving = ref(false)
const rows = computed(() => actorSourceRows(settings.value))

async function load(): Promise<void> {
  if (!bridge?.actors) return
  try {
    settings.value = await bridge.actors.getSettings()
  } catch (error) {
    toast.error(errorText(error))
  }
}

async function save(next: ActorSettings): Promise<void> {
  if (!bridge?.actors || next === settings.value) return
  const previous = settings.value
  settings.value = next
  saving.value = true
  try {
    settings.value = await bridge.actors.setSettings(next)
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
