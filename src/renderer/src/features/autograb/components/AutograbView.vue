<template>
  <div class="ag-view">
    <header class="ag-toolbar">
      <p class="ag-state">
        <span
          class="ag-state-dot"
          :class="{ 'is-on': data?.enabled }"
          aria-hidden="true"
        />
        <span role="status" aria-live="polite">{{
          data ? statusLine(data) : '正在读取追更状态'
        }}</span>
        <UiLoadingDots v-if="!data || data.running" />
        <span v-if="usageText" class="ag-usage">{{ usageText }}</span>
      </p>
      <UiButton
        icon="settings"
        :label="policyLabel"
        @click="openAutograbSettings('tv')"
      />
      <UiButton
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

    <SettingsGroup v-if="needs.length || ag.error.value" class="ag-needs">
      <SettingsRow
        v-if="ag.error.value"
        title="读取追更状态失败"
        :description="ag.error.value"
      >
        <UiButton size="sm" label="重试" @click="ag.reload" />
      </SettingsRow>
      <SettingsRow v-for="need in needs" :key="need.kind">
        <template #description>
          <span class="ag-need">
            <UiIcon class="ag-need-icon" name="warning" size="sm" />{{
              need.text
            }}
          </span>
        </template>
        <UiButton
          v-if="need.action"
          size="sm"
          :label="need.action.label"
          @click="act(need.action.to)"
        />
      </SettingsRow>
    </SettingsGroup>

    <PendingList
      v-if="pending.length"
      :episodes="pending"
      :posters="posters"
      :series="seriesById"
      :busy="ag.busy"
      :grabbing-all="ag.grabbingAll.value"
      @grab="ag.grab"
      @grab-best="grabBest"
      @skip="ag.skip"
      @retry="ag.retry"
      @open="key => (episodeKey = key)"
    />

    <TrackedSeriesList
      v-if="data"
      :tracked="tracked"
      :untracked="untracked"
      :posters="posters"
      :pending="pendingBySeries"
      :busy="tracking"
      @open="openSheet"
      @track="track"
    />

    <SettingsGroup v-if="history.length">
      <SettingsRow
        title="记录"
        :description="`最近 ${history.length} 集已转存、入库或跳过；追更存进 115 的可以撤销`"
      >
        <UiButton
          size="sm"
          :icon="historyOpen ? 'chevronUp' : 'chevronDown'"
          :label="historyOpen ? '收起' : '展开'"
          :aria-expanded="historyOpen"
          @click="historyOpen = !historyOpen"
        />
      </SettingsRow>
      <AutograbEpisodes
        v-if="historyOpen"
        class="ag-rows-after"
        :episodes="history"
        :busy="ag.busy"
        @grab="ag.grab"
        @revert="ag.revert"
        @skip="ag.skip"
        @retry="ag.retry"
      />
    </SettingsGroup>

    <EpisodeGrabSheet :episode-key="episodeKey" @close="episodeKey = null" />
    <SeriesGrabSheet
      :series-id="sheetSeries"
      :title="sheetTitle"
      @close="sheetSeries = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 自动追更页的「剧集」栏（桌面 /autograb 与 NAS 共用）：一条工具栏（状态句：开启 · 上次 / 下次检查 · 今天的 115 用量；
 * 全局策略、立即检查、总开关），缺前置条件时下面一组玻璃分组（SettingsGroup，各带就地操作）；
 * 然后是「需要你处理（卡片，可全部转存推荐资源）→ 在追的剧（海报墙）→ 记录」；卡片上「另 N 个」打开这一集的侧板（EpisodeGrabSheet）。
 * 每部剧的设置收进侧拉面板（SeriesGrabSheet）；带 ?series=<剧 id>（&title=）进来（播放器「去追更」）时直接打开那部剧的面板。
 * keep-alive 下离开页面时关掉面板。
 */
import { computed, onDeactivated, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { confirmDialog } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { openNetdiskSettings } from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type { AutograbSeries } from '../../../../../shared/contract/autograb'

import {
  historyEpisodes,
  pendingEpisodes,
  prerequisites,
  statusLine,
  trackedSeries,
  untrackedSeries,
} from '../autograb-rules'
import { openAutograbSettings } from '../open-settings'
import { TV_MODE_OPTIONS, optionLabel, prefsSummary } from '../prefs-rules'
import { useAutograb } from '../use-autograb'
import { useFullAutoFolder } from '../use-full-auto-folder'
import { useSeriesPosters } from '../use-series-posters'
import AutograbEpisodes from './AutograbEpisodes.vue'
import EpisodeGrabSheet from './EpisodeGrabSheet.vue'
import PendingList from './PendingList.vue'
import SeriesGrabSheet from './SeriesGrabSheet.vue'
import TrackedSeriesList from './TrackedSeriesList.vue'

const ag = useAutograb()
const data = computed(() => ag.overview.value)
const fullAuto = useFullAutoFolder({
  overview: () => ag.overview.value,
  setSeries: ag.setSeries,
  warn: text => void toast.warning(text),
})
const ready = computed(
  () => !!data.value?.ready.loggedIn && !!data.value.ready.pansou
)
const needs = computed(() => (data.value ? prerequisites(data.value) : []))
const pending = computed(() => pendingEpisodes(data.value))
/** 剧 id → 待处理集数（在追列表里标出） */
const pendingBySeries = computed(() => {
  const counts = new Map<number, number>()
  for (const ep of pending.value)
    counts.set(ep.seriesId, (counts.get(ep.seriesId) ?? 0) + 1)
  return counts
})
/** 剧 id → 海报（待处理分组头用） */
const posters = useSeriesPosters(() => data.value?.series ?? [])
/** 剧 id → 剧（待处理卡片说明为什么要处理） */
const seriesById = computed(
  () => new Map((data.value?.series ?? []).map(s => [s.seriesId, s]))
)
const tracked = computed(() => trackedSeries(data.value))
const untracked = computed(() => untrackedSeries(data.value))
const history = computed(() => historyEpisodes(data.value))
const historyOpen = ref(false)
/** 全局策略按钮上的字：全局策略 · 全自动 · 均衡 */
const policyLabel = computed(() => {
  const policy = data.value?.policy
  if (!policy) return '全局策略'
  return `全局策略 · ${optionLabel(TV_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})
const usageText = computed(() =>
  data.value
    ? `今天 115 查询 ${data.value.today.snaps} 次、转存 ${data.value.today.receives} 次`
    : undefined
)

/** 前置条件的就地操作 */
function act(to: 'settings-pan' | 'resume'): void {
  if (to === 'resume') void ag.resume()
  else openNetdiskSettings()
}

// 侧拉面板：点在追的剧，或带 ?series= 进来
const sheetSeries = ref<number | null>(null)
/** 深链带来的剧名（总览里没有这部剧时面板用） */
const sheetTitle = ref<string | undefined>()
const route = useRoute()
const router = useRouter()

function openSheet(seriesId: number): void {
  sheetTitle.value = undefined
  sheetSeries.value = seriesId
}

watch(
  () => route.query.series,
  value => {
    if (route.path !== '/autograb') return
    const id = Number(Array.isArray(value) ? value[0] : value)
    if (!Number.isInteger(id) || id <= 0) return
    sheetSeries.value = id
    const name = route.query.title
    sheetTitle.value = typeof name === 'string' ? name : undefined
    void router.replace({
      query: { ...route.query, series: undefined, title: undefined },
    })
  },
  { immediate: true }
)
/** 「另 N 个」打开的单集侧板 */
const episodeKey = ref<string | null>(null)
onDeactivated(() => {
  sheetSeries.value = null
  episodeKey.value = null
})

/** 全部转存推荐资源：确认后逐集转存最佳候选 */
async function grabBest(keys: string[]): Promise<void> {
  const ok = await confirmDialog({
    title: `转存 ${keys.length} 集的推荐资源？`,
    content:
      '每集转存匹配分最高的那个文件，存到各自剧的文件夹。存错了可以在「记录」里撤销。',
    okText: '全部转存',
  })
  if (ok) await ag.grabBest(keys)
}

// 一键追更：先按待确认追（要全自动再进面板改）
const tracking = reactive(new Set<number>())

async function track(series: AutograbSeries): Promise<void> {
  tracking.add(series.seriesId)
  try {
    await fullAuto.changeMode(series, 'confirm')
  } finally {
    tracking.delete(series.seriesId)
  }
}
</script>

<style scoped src="./autograb-view.css"></style>
