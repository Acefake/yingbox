<template>
  <SettingsGroup :title="KIND_TEXT[kind]" :footer="footer">
    <SettingsRow
      :title="kind === 'tv' ? '新集播出后' : '上线后'"
      :description="modeDescription"
    >
      <UiSegmented
        :model-value="policy.mode"
        :options="kind === 'tv' ? TV_MODE_OPTIONS : MOVIE_MODE_OPTIONS"
        :label="`${KIND_TEXT[kind]}的默认方式`"
        size="sm"
        @update:model-value="guard.changeMode"
      />
    </SettingsRow>
    <SettingsRow v-if="guard.picking.value" stacked>
      <AutograbFolderPrompt
        :title="`所有${KIND_TEXT[kind]}`"
        :global="kind"
        @pick="guard.pick"
        @cancel="guard.cancel"
      />
    </SettingsRow>
    <SettingsRow
      v-if="kind === 'tv' && policy.mode === 'auto'"
      title="新剧先确认"
      description="每部新剧先手动确认几集，认准了再自动转存"
    >
      <UiSegmented
        :model-value="String(policy.confirmFirst)"
        :options="CONFIRM_FIRST_OPTIONS"
        label="新剧先确认几集"
        size="sm"
        @update:model-value="value => save({ confirmFirst: Number(value) })"
      />
    </SettingsRow>
    <SettingsRow
      title="默认目录"
      :description="customFolder ? undefined : '沿用原转存位置'"
    >
      <TargetFolderPill
        :folder="folder"
        :presets="presets"
        :active="customFolder ? null : 'legacy'"
        prefix="存到"
        size="sm"
        align="right"
        @pick="chooseFolder"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 自动追更里一种媒体（剧集 / 电影）的方式分组：默认方式（没单独设的剧 / 电影按它）、
 * 剧集全自动时「新剧先确认几集」、默认目录（与设置 · 网盘的转存位置是同一份设置 pan115.tvCid / movieCid）。
 * 切全自动而转存目标解析到 115 根目录时先在下面弹目录树（use-policy-folder.ts），选好的文件夹存成默认目录再切。
 */
import { computed } from 'vue'

import { toast } from '@/components/ui/toast'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import {
  AutograbFolderPrompt,
  CONFIRM_FIRST_OPTIONS,
  MOVIE_MODE_OPTIONS,
  TV_MODE_OPTIONS,
  usePolicyFolder,
} from '@/features/autograb'
import { type FolderPick, TargetFolderPill } from '@/features/netdisk'
import {
  SettingsGroup,
  SettingsRow,
  setSetting,
  useSetting,
} from '@/features/settings'
import type {
  GrabPolicy,
  GrabPolicyPatch,
} from '../../../../../shared/contract/grab-policy'
import {
  TARGET_SETTING_KEYS,
  type TargetFolder,
  type TargetSettings,
  defaultFolder,
  hasKindDefault,
  legacyFolder,
} from '../../../../../shared/netdisk/target-folder'

const KIND_TEXT = { tv: '剧集', movie: '电影' } as const

const props = defineProps<{
  kind: 'tv' | 'movie'
  policy: GrabPolicy
  /** 电影追踪面板里单独选的文件夹（优先于电影默认目录）；剧集不传 */
  panelCid?: string
  /** 改策略；成功为 true */
  save: (patch: GrabPolicyPatch) => Promise<boolean>
}>()

const refs = TARGET_SETTING_KEYS.map(key => [key, useSetting(key)] as const)
const settings = computed(
  () =>
    Object.fromEntries(
      refs.map(([key, value]) => [key, value.value])
    ) as unknown as TargetSettings
)
const cidSetting = useSetting(
  props.kind === 'tv' ? 'pan115.tvCid' : 'pan115.movieCid'
)
const nameSetting = useSetting(
  props.kind === 'tv' ? 'pan115.tvName' : 'pan115.movieName'
)

const folder = computed(() => defaultFolder(props.kind, settings.value))
const customFolder = computed(() => hasKindDefault(props.kind, settings.value))
const presets = computed(() => [
  {
    key: 'legacy',
    label: '沿用原转存位置',
    icon: 'history' as const,
    folder: legacyFolder(settings.value),
  },
])

const guard = usePolicyFolder({
  targetCid: () => props.panelCid || folder.value.cid,
  setMode: mode => props.save({ mode }),
  // 等设置写完再切方式：主进程按设置里的默认目录判断能不能全自动
  saveDefaultFolder: async picked => {
    const tv = props.kind === 'tv'
    await setSetting(tv ? 'pan115.tvCid' : 'pan115.movieCid', picked.cid)
    await setSetting(tv ? 'pan115.tvName' : 'pan115.movieName', picked.name)
  },
  warn: text => void toast.warning(text),
})

const modeDescription = computed(() =>
  props.kind === 'tv'
    ? '没单独设的在播剧都按这里追'
    : '加进追踪、没单独设的电影按这里'
)
const footer = computed(() =>
  props.kind === 'tv'
    ? '全自动只存验过的那一集；追更面板里每部剧可以「单独设」方式和资源偏好。'
    : '电影在数字发行后每天搜一次，30 天为止；电影追踪里每部可以「单独设」。'
)

/** 选了文件夹存成默认目录；选「沿用原转存位置」清掉单独设置 */
function chooseFolder(pick: FolderPick): void {
  const picked: TargetFolder | null = 'folder' in pick ? pick.folder : null
  cidSetting.value = picked?.cid ?? ''
  nameSetting.value = picked?.name ?? ''
}
</script>
