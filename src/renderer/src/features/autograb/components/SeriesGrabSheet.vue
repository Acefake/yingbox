<template>
  <GrabSheet
    :open="seriesId !== null"
    :title="series?.title ?? ''"
    :subtitle="subtitle"
    @close="emit('close')"
  >
    <template v-if="series && data">
      <SettingsGroup>
        <SettingsRow title="追更方式">
          <ItemPolicyMenu
            :title="series.title"
            :custom="isCustom(series.mode, series.prefs)"
            :effective="series.effectiveMode"
            @follow="follow"
            @custom="editing = true"
          />
        </SettingsRow>
        <SettingsRow v-if="series.effectiveMode !== 'off'" title="转存位置">
          <TargetFolderPill
            v-bind="folderPill(series)"
            size="sm"
            variant="plain"
            align="right"
            :disabled="!data.ready.loggedIn"
            @pick="pickFolder"
          />
        </SettingsRow>
        <template v-if="hints.length" #footer>{{ hints.join('；') }}</template>
      </SettingsGroup>

      <AutograbFolderPrompt
        v-if="fullAuto.picking.value === series.seriesId"
        :title="series.title"
        @pick="fullAuto.pick"
        @cancel="fullAuto.cancel"
      />
      <GrabOverrideForm
        v-if="editing"
        :title="`${series.title} 单独设`"
        :mode-options="TV_MODE_OPTIONS"
        :initial-mode="series.effectiveMode"
        :value="series.prefs"
        :inherit="data.policy.prefs"
        @save="saveSeries"
        @cancel="editing = false"
      />

      <SettingsGroup v-if="episodes.length" title="最近的集">
        <AutograbEpisodes
          best-only
          :show-series="false"
          :episodes="episodes"
          :busy="ag.busy"
          @grab="ag.grab"
          @revert="ag.revert"
          @skip="ag.skip"
          @retry="ag.retry"
        />
      </SettingsGroup>
    </template>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 一部剧的追更侧拉面板（设置页同款玻璃分组）：把这部剧「怎么追」的设置收在一起——方式（跟随 / 单独设，单独设展开表单覆盖方式与资源偏好）、
 * 转存位置、还要手动确认几集、下一集播出日，以及这部剧最近各集的状态。
 * 切到（或跟随成）全自动而没有可用文件夹时，在侧板里就地选目录（use-full-auto-folder.ts）。
 * seriesId 为 null 时关闭；总览里没有这部剧（还没开播、没设过）时用 title 兜底，设置照样能存。
 */
import { computed, ref, watch } from 'vue'

import { toast } from '@/components/ui/toast'
import {
  type FolderPick,
  type FolderPreset,
  TargetFolderPill,
} from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type {
  AutograbSeries,
  AutograbSeriesPatch,
} from '../../../../../shared/contract/autograb'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'
import type { GrabPrefsOverride } from '../../../../../shared/contract/grab-prefs'
import {
  type TargetFolder,
  folderOf,
} from '../../../../../shared/netdisk/target-folder'

import { confirmsLeft, nextAirText } from '../autograb-rules'
import {
  TV_MODE_OPTIONS,
  isCustom,
  itemPolicyText,
  overrideSummary,
} from '../prefs-rules'
import { useAutograb } from '../use-autograb'
import { useFullAutoFolder } from '../use-full-auto-folder'
import AutograbEpisodes from './AutograbEpisodes.vue'
import AutograbFolderPrompt from './AutograbFolderPrompt.vue'
import GrabOverrideForm from './GrabOverrideForm.vue'
import GrabSheet from './GrabSheet.vue'
import ItemPolicyMenu from './ItemPolicyMenu.vue'

const props = defineProps<{
  seriesId: number | null
  /** 总览里没有这部剧时显示的剧名 */
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()

const ag = useAutograb()
const data = computed(() => ag.overview.value)
/** 存设置时带上剧名（这部剧不在近期日历里时，后端靠它起名） */
const save = (seriesId: number, patch: AutograbSeriesPatch): Promise<boolean> =>
  ag.setSeries(seriesId, props.title ? { title: props.title, ...patch } : patch)
const fullAuto = useFullAutoFolder({
  overview: () => ag.overview.value,
  setSeries: save,
  warn: text => void toast.warning(text),
})
/** 是否展开了「单独设」表单 */
const editing = ref(false)
watch(
  () => props.seriesId,
  () => (editing.value = false)
)

const series = computed<AutograbSeries | null>(() => {
  const id = props.seriesId
  const overview = data.value
  if (id === null || !overview) return null
  return (
    overview.series.find(s => s.seriesId === id) ?? {
      seriesId: id,
      title: props.title ?? `#${id}`,
      mode: 'inherit',
      effectiveMode: overview.policy.mode,
      confirmFirst: overview.policy.confirmFirst,
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
      nextAirDate: null,
    }
  )
})
/** 标题下一句：跟随 · 全自动 · 下一集 11月3日 */
const subtitle = computed(() => {
  const item = series.value
  if (!item) return ''
  return [
    itemPolicyText(isCustom(item.mode, item.prefs), item.effectiveMode),
    nextAirText(item),
  ]
    .filter(Boolean)
    .join(' · ')
})
/** 设置下面的说明：不追时怎么开、单独设了哪些偏好、全自动还要确认几集 */
const hints = computed(() => {
  const item = series.value
  if (!item) return []
  if (item.effectiveMode === 'off')
    return ['现在不追这部剧。追更方式选「单独设…」可切到待确认或全自动。']
  const left = confirmsLeft(item.confirmed, item.confirmFirst)
  return [
    overrideSummary(item.prefs),
    item.effectiveMode === 'auto' && left
      ? `还要手动确认 ${left} 集才会自动转存`
      : '',
  ].filter(Boolean)
})
const episodes = computed(() =>
  (data.value?.episodes ?? []).filter(ep => ep.seriesId === props.seriesId)
)

/** 跟随全局：清掉覆盖项，方式设回跟随（全局是全自动且没文件夹时先选文件夹） */
async function follow(): Promise<void> {
  const item = series.value
  if (!item) return
  editing.value = false
  if (Object.keys(item.prefs).length) await save(item.seriesId, { prefs: {} })
  if (item.mode !== 'inherit') await fullAuto.changeMode(item, 'inherit')
}

/** 单独设：先存覆盖项，方式变了再切（切全自动可能先选文件夹） */
async function saveSeries(result: {
  mode: GrabMode
  prefs: GrabPrefsOverride
}): Promise<void> {
  const item = series.value
  if (!item) return
  if (!(await save(item.seriesId, { prefs: result.prefs }))) return
  editing.value = false
  if (result.mode !== item.mode) await fullAuto.changeMode(item, result.mode)
}

/** 转存位置胶囊：单独选了文件夹显示它，否则是「剧集默认目录」 */
function folderPill(item: AutograbSeries): {
  folder: TargetFolder
  active: string | null
  presets: FolderPreset[]
} {
  const { cid, name } = data.value?.defaultFolder ?? { cid: '0', name: '' }
  const fallback = folderOf(cid, name)
  return {
    folder: item.cid ? folderOf(item.cid, item.cidName) : fallback,
    active: item.cid ? null : 'default',
    presets: [
      {
        key: 'default',
        label: '剧集默认目录',
        icon: 'tv' as const,
        folder: fallback,
      },
    ],
  }
}

/** 选「剧集默认目录」清掉单独设置；选了文件夹就存成这部剧的位置 */
async function pickFolder(pick: FolderPick): Promise<void> {
  const item = series.value
  if (!item) return
  const folder = 'folder' in pick ? pick.folder : null
  await save(item.seriesId, {
    cid: folder?.cid ?? '',
    cidName: folder ? folder.name || '根目录' : '',
  })
}
</script>
