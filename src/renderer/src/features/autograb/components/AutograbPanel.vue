<template>
  <section class="autograb" aria-label="追更">
    <header class="autograb-head">
      <div class="autograb-head-text">
        <h2 class="autograb-title">追更</h2>
        <p class="autograb-sub">
          新集播出后去 PanSou 搜 115 分享，验过文件只把那一集存到这部剧的 115
          文件夹
        </p>
      </div>
      <UiButton
        v-if="data && canResume(data)"
        size="sm"
        label="恢复"
        @click="ag.resume"
      />
      <UiButton
        size="sm"
        variant="plain"
        icon="settings"
        label="策略"
        @click="openAutograbSettings('tv')"
      />
      <UiButton
        size="sm"
        variant="plain"
        icon="refresh"
        label="立即检查"
        :loading="data?.running"
        :disabled="!ready"
        @click="ag.runNow"
      />
      <UiSwitch
        :model-value="data?.enabled ?? false"
        label="追更总开关"
        @update:model-value="ag.setEnabled"
      />
    </header>

    <p v-if="ag.error.value" class="autograb-notice">{{ ag.error.value }}</p>
    <p v-else-if="notice" class="autograb-notice">{{ notice }}</p>
    <p v-if="data" class="autograb-usage">
      今天已用 115 查询 {{ data.today.snaps }} 次、转存
      {{ data.today.receives }} 次 · 没单独设的剧：{{ policyText }}
    </p>

    <div v-if="data?.series.length" class="autograb-series">
      <div
        v-for="series in data.series"
        :key="series.seriesId"
        class="autograb-row"
      >
        <div class="autograb-row-main">
          <span class="autograb-name">{{ series.title }}</span>
          <span
            v-if="
              series.effectiveMode !== 'off' && overrideSummary(series.prefs)
            "
            class="autograb-folder"
          >
            {{ overrideSummary(series.prefs) }}
          </span>
          <span
            v-if="
              series.effectiveMode === 'auto' &&
              confirmsLeft(series.confirmed, series.confirmFirst)
            "
            class="autograb-hint"
          >
            还要手动确认
            {{ confirmsLeft(series.confirmed, series.confirmFirst) }}
            集才会自动转存
          </span>
        </div>
        <TargetFolderPill
          v-if="series.effectiveMode !== 'off'"
          v-bind="folderPill(series)"
          size="sm"
          variant="plain"
          align="right"
          :disabled="!data.ready.loggedIn"
          @pick="pick => pickFolder(series.seriesId, pick)"
        />
        <ItemPolicyMenu
          :title="series.title"
          :custom="isCustom(series.mode, series.prefs)"
          :effective="series.effectiveMode"
          @follow="follow(series)"
          @custom="editing = series.seriesId"
        />
        <div
          v-if="fullAuto.picking.value === series.seriesId"
          class="autograb-picker"
        >
          <AutograbFolderPrompt
            :title="series.title"
            @pick="fullAuto.pick"
            @cancel="fullAuto.cancel"
          />
        </div>
        <div v-if="editing === series.seriesId" class="autograb-picker">
          <GrabOverrideForm
            :title="`${series.title} 单独设`"
            :mode-options="TV_MODE_OPTIONS"
            :initial-mode="series.effectiveMode"
            :value="series.prefs"
            :inherit="data.policy.prefs"
            @save="result => saveSeries(series, result)"
            @cancel="editing = null"
          />
        </div>
      </div>
    </div>
    <p v-else-if="data" class="autograb-empty">
      最近两周没有在播的剧（剧集库里匹配了 TMDB 的剧才会出现在这里）
    </p>

    <AutograbEpisodes
      v-if="data?.episodes.length"
      :episodes="data.episodes"
      :focus-key="focusKey"
      @grab="ag.grab"
      @revert="ag.revert"
      @skip="ag.skip"
      @retry="ag.retry"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * 追更面板（追剧日历页里展开）：总开关、熔断恢复、立即检查、「策略」跳到设置 · 自动追更（剧集的全局方式与资源偏好在那里改）；
 * 最近在播的剧逐部一个「跟随 / 单独设」胶囊（ItemPolicyMenu）：跟随即方式与偏好都按全局，单独设在这一行下面展开
 * GrabOverrideForm 覆盖方式与资源偏好；转存位置胶囊（剧集默认目录 / 最近使用 / 浏览 115 目录树，没单独选时跟剧集默认目录）。
 * 一部剧实际会变成全自动而它没有可用文件夹（解析到根目录）时，先在这一行下面弹文件夹选择，选好才切（use-full-auto-folder.ts）；
 * 下面是已追剧最近各集的状态与候选（见 AutograbEpisodes），focusKey 指定要定位的一集。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import { toast } from '@/components/ui/toast'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import {
  type FolderPick,
  type FolderPreset,
  TargetFolderPill,
} from '@/features/netdisk'
import type { AutograbSeries } from '../../../../../shared/contract/autograb'
import type { GrabPrefsOverride } from '../../../../../shared/contract/grab-prefs'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'
import {
  type TargetFolder,
  folderOf,
} from '../../../../../shared/netdisk/target-folder'

import { canResume, confirmsLeft, overviewNotice } from '../autograb-rules'
import { openAutograbSettings } from '../open-settings'
import {
  TV_MODE_OPTIONS,
  isCustom,
  optionLabel,
  overrideSummary,
  prefsSummary,
} from '../prefs-rules'
import { useAutograb } from '../use-autograb'
import { useFullAutoFolder } from '../use-full-auto-folder'
import AutograbEpisodes from './AutograbEpisodes.vue'
import AutograbFolderPrompt from './AutograbFolderPrompt.vue'
import GrabOverrideForm from './GrabOverrideForm.vue'
import ItemPolicyMenu from './ItemPolicyMenu.vue'

defineProps<{ focusKey?: string | null }>()

const ag = useAutograb()
const data = computed(() => ag.overview.value)
const fullAuto = useFullAutoFolder({
  overview: () => ag.overview.value,
  setSeries: ag.setSeries,
  warn: text => void toast.warning(text),
})
const notice = computed(() => (data.value ? overviewNotice(data.value) : null))
const ready = computed(
  () => !!data.value?.ready.loggedIn && !!data.value.ready.pansou
)
/** 全局策略的一句话：全自动 · 均衡 · 4K */
const policyText = computed(() => {
  const policy = data.value?.policy
  if (!policy) return ''
  return `${optionLabel(TV_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})
/** 正在单独设哪部剧；null = 没有 */
const editing = ref<number | null>(null)

/** 跟随全局：清掉覆盖项，方式设回跟随（全局是全自动且没文件夹时先选文件夹） */
async function follow(series: AutograbSeries): Promise<void> {
  editing.value = null
  if (Object.keys(series.prefs).length)
    await ag.setSeries(series.seriesId, { prefs: {} })
  if (series.mode !== 'inherit') await fullAuto.changeMode(series, 'inherit')
}

/** 单独设：先存覆盖项，方式变了再切（切全自动可能先弹文件夹选择） */
async function saveSeries(
  series: AutograbSeries,
  result: { mode: GrabMode; prefs: GrabPrefsOverride }
): Promise<void> {
  if (!(await ag.setSeries(series.seriesId, { prefs: result.prefs }))) return
  editing.value = null
  if (result.mode !== series.mode)
    await fullAuto.changeMode(series, result.mode)
}

/** 一部剧的转存位置胶囊：单独选了文件夹显示它，否则是「剧集默认目录」 */
function folderPill(series: AutograbSeries): {
  folder: TargetFolder
  active: string | null
  presets: FolderPreset[]
} {
  const { cid, name } = data.value?.defaultFolder ?? { cid: '0', name: '' }
  const fallback = folderOf(cid, name)
  return {
    folder: series.cid ? folderOf(series.cid, series.cidName) : fallback,
    active: series.cid ? null : 'default',
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
async function pickFolder(seriesId: number, pick: FolderPick): Promise<void> {
  const folder = 'folder' in pick ? pick.folder : null
  await ag.setSeries(seriesId, {
    cid: folder?.cid ?? '',
    cidName: folder ? folder.name || '根目录' : '',
  })
}
</script>

<style scoped>
.autograb {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

.autograb-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.autograb-head-text {
  flex: 1;
  min-width: 0;
}

.autograb-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.autograb-sub,
.autograb-usage,
.autograb-empty,
.autograb-hint,
.autograb-folder {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.autograb-notice {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--warning);
}

.autograb-series {
  display: flex;
  flex-direction: column;
}

.autograb-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--separator);
}

.autograb-row-main {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.autograb-name {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.autograb-picker {
  flex-basis: 100%;
}
</style>
