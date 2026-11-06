<template>
  <GrabSheet
    :open="seriesId !== null"
    :title="series?.title ?? ''"
    :subtitle="subtitle"
    hero
    :image="image"
    @close="close"
  >
    <template v-if="series && data">
      <section class="sg-block" aria-labelledby="sg-mode-title">
        <h3 id="sg-mode-title" class="sg-label">追更方式</h3>
        <UiSegmented
          class="sg-modes"
          :model-value="series.effectiveMode"
          :options="TV_MODE_OPTIONS"
          :label="`${series.title} 的追更方式`"
          @update:model-value="setMode"
        />
        <p v-if="hints.length" class="sg-hint">{{ hints.join('；') }}</p>
      </section>
      <SettingsGroup v-if="series.effectiveMode !== 'off'">
        <SettingsRow
          title="转存位置"
          description="转存到 115 网盘；有媒体库关联时可沿用对应目录，否则存到选定目录的剧名子文件夹"
        >
          <TargetFolderPill
            v-bind="folderPill(series)"
            size="sm"
            variant="plain"
            align="right"
            :disabled="!data.ready.loggedIn"
            @pick="pickFolder"
          />
        </SettingsRow>
        <SettingsRow
          title="资源偏好"
          :description="overrideSummary(series.prefs) || '跟随全局'"
        >
          <UiButton
            size="sm"
            :label="Object.keys(series.prefs).length ? '修改' : '单独设'"
            @click="editing = true"
          />
        </SettingsRow>
      </SettingsGroup>

      <AutograbFolderPrompt
        v-if="fullAuto.picking.value === series.seriesId"
        :title="series.title"
        @pick="fullAuto.pick"
        @cancel="fullAuto.cancel"
      />
      <GrabOverrideForm
        v-if="editing"
        ref="overrideForm"
        :title="`${series.title} 单独设`"
        :mode-options="TV_MODE_OPTIONS"
        :initial-mode="series.effectiveMode"
        :value="series.prefs"
        :inherit="data.policy.prefs"
        @save="saveSeries"
        @cancel="editing = false"
      />

      <SeriesPackProgress
        v-if="series.effectiveMode !== 'off'"
        :data="data"
        :series="series"
        :episodes="episodes"
      />
      <SettingsGroup v-if="episodes.length" title="分集明细">
        <SettingsRow title="查看每集的状态和资源">
          <UiButton
            size="sm"
            :label="
              detailsOpen ? '收起明细' : `展开明细（${episodes.length} 集）`
            "
            :aria-expanded="detailsOpen"
            @click="detailsOpen = !detailsOpen"
          />
        </SettingsRow>
        <AutograbEpisodes
          v-if="detailsOpen"
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

    <template v-if="series && data" #footer>
      <UiButton
        v-if="isCustom(series.mode, series.prefs)"
        size="sm"
        variant="plain"
        label="恢复跟随全局"
        @click="follow"
      />
      <span class="sg-grow" />
      <UiButton
        v-if="series.effectiveMode !== 'off'"
        class="sg-stop"
        size="sm"
        variant="plain"
        :label="series.pending ? '取消' : '取消追剧'"
        :disabled="saving"
        @click="cancelTracking"
      />
      <UiButton
        variant="primary"
        :label="series.pending ? '确认并开始追剧' : '保存设置'"
        :loading="saving"
        :disabled="fullAuto.picking.value !== null"
        @click="confirm"
      />
    </template>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 一部剧的追更设置草稿：方式、目录和偏好只在最终确认时保存。
 * 新任务确认后才开始合集搜索；关闭未确认任务会取消草稿，分集操作收在明细中。
 */
import { computed, ref, watch } from 'vue'

import { toast } from '@/components/ui/toast'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { libraryImage } from '@/features/library'
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
import {
  type GrabMode,
  effectiveMode,
} from '../../../../../shared/contract/grab-policy'
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
import { useSeriesPosters } from '../use-series-posters'
import { useSeriesSubmit } from '../use-series-submit'
import AutograbEpisodes from './AutograbEpisodes.vue'
import AutograbFolderPrompt from './AutograbFolderPrompt.vue'
import GrabOverrideForm from './GrabOverrideForm.vue'
import GrabSheet from './GrabSheet.vue'
import SeriesPackProgress from './SeriesPackProgress.vue'

const props = defineProps<{
  seriesId: number | null
  /** 总览里没有这部剧时显示的剧名 */
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()

const ag = useAutograb()
const data = computed(() => ag.overview.value)
/** 表单变更只留在当前面板，最终确认时写入。 */
const draft = ref<AutograbSeriesPatch>({})
const overrideForm = ref<InstanceType<typeof GrabOverrideForm> | null>(null)
const { saving, confirm, close, cancelTracking } = useSeriesSubmit({
  series: () => series.value,
  patch: () => draft.value,
  ag,
  prepare: async () => {
    if (editing.value && overrideForm.value)
      await saveSeries(overrideForm.value.readDraft())
    return fullAuto.picking.value === null
  },
  close: () => emit('close'),
})
const save = async (
  _seriesId: number,
  patch: AutograbSeriesPatch
): Promise<boolean> => {
  draft.value = { ...draft.value, ...patch }
  return true
}
const fullAuto = useFullAutoFolder({
  overview: () => ag.overview.value,
  setSeries: save,
  warn: text => void toast.warning(text),
})
const posters = useSeriesPosters(() => data.value?.series ?? [])
const image = computed(() =>
  props.seriesId === null
    ? null
    : libraryImage(posters.value.get(props.seriesId) ?? null, 300)
)
/** 是否展开了「单独设」表单 */
const editing = ref(false)
const detailsOpen = ref(false)
const promptedFor = ref<number | null>(null)
watch(
  () => props.seriesId,
  () => {
    editing.value = false
    detailsOpen.value = false
    promptedFor.value = null
    draft.value = {}
    fullAuto.cancel()
  }
)

const series = computed<AutograbSeries | null>(() => {
  const id = props.seriesId
  const overview = data.value
  if (id === null || !overview) return null
  const source = overview.series.find(s => s.seriesId === id) ?? {
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
  const merged = { ...source, ...draft.value }
  return {
    ...merged,
    effectiveMode: effectiveMode(merged.mode, overview.policy),
  }
})
watch(
  () => series.value,
  item => {
    if (
      item &&
      promptedFor.value !== item.seriesId &&
      item.effectiveMode === 'auto' &&
      !item.cid &&
      (!data.value?.defaultFolder.cid ||
        data.value.defaultFolder.cid === '0') &&
      fullAuto.picking.value === null
    ) {
      promptedFor.value = item.seriesId
      void fullAuto.changeMode(item, item.mode)
    }
  },
  { immediate: true }
)

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
    return ['现在不追这部剧。选「待确认」或「全自动」开始追。']
  const left = confirmsLeft(item.confirmed, item.confirmFirst)
  return [
    item.mode === 'inherit' ? '跟随全局' : '单独设的方式',
    item.effectiveMode === 'auto' && left
      ? `还要手动确认 ${left} 集才会自动转存`
      : '',
  ].filter(Boolean)
})
const episodes = computed(() =>
  (data.value?.episodes ?? []).filter(ep => ep.seriesId === props.seriesId)
)

/** 分段里选了一种方式：按这部剧单独设（切全自动而没有文件夹时先选文件夹） */
async function setMode(mode: GrabMode): Promise<void> {
  const item = series.value
  if (!item) return
  if (mode === item.effectiveMode) {
    fullAuto.cancel()
    return
  }
  editing.value = false
  await fullAuto.changeMode(item, mode)
}

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

<style scoped src="./series-grab-sheet.css"></style>
