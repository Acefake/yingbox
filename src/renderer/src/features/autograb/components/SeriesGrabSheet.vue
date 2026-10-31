<template>
  <GrabSheet
    :open="seriesId !== null"
    :title="series?.title ?? ''"
    subtitle="这部剧怎么追"
    @close="emit('close')"
  >
    <template v-if="series && data">
      <div class="series-sheet-row">
        <span class="series-sheet-label">追更方式</span>
        <ItemPolicyMenu
          :title="series.title"
          :custom="isCustom(series.mode, series.prefs)"
          :effective="series.effectiveMode"
          @follow="follow"
          @custom="editing = true"
        />
      </div>
      <p v-if="series.effectiveMode === 'off'" class="series-sheet-hint">
        现在不追这部剧。选「单独设…」可切到待确认或全自动。
      </p>
      <p v-else-if="overrideSummary(series.prefs)" class="series-sheet-hint">
        {{ overrideSummary(series.prefs) }}
      </p>
      <p
        v-if="
          series.effectiveMode === 'auto' &&
          confirmsLeft(series.confirmed, series.confirmFirst)
        "
        class="series-sheet-hint"
      >
        还要手动确认
        {{ confirmsLeft(series.confirmed, series.confirmFirst) }}
        集才会自动转存
      </p>
      <p v-if="nextAirText(series)" class="series-sheet-hint">
        {{ nextAirText(series) }}
      </p>

      <div v-if="series.effectiveMode !== 'off'" class="series-sheet-row">
        <span class="series-sheet-label">转存位置</span>
        <TargetFolderPill
          v-bind="folderPill(series)"
          size="sm"
          variant="plain"
          align="right"
          :disabled="!data.ready.loggedIn"
          @pick="pickFolder"
        />
      </div>

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

      <AutograbEpisodes
        v-if="episodes.length"
        title="这部剧最近的集"
        best-only
        :episodes="episodes"
        :busy="ag.busy"
        @grab="ag.grab"
        @revert="ag.revert"
        @skip="ag.skip"
        @retry="ag.retry"
      />
    </template>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 一部剧的追更侧板：把这部剧「怎么追」的设置收在一起——方式（跟随 / 单独设，单独设展开表单覆盖方式与资源偏好）、
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
import { TV_MODE_OPTIONS, isCustom, overrideSummary } from '../prefs-rules'
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

<style scoped>
.series-sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.series-sheet-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.series-sheet-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
