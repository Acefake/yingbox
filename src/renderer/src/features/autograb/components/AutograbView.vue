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

    <SettingsGroup
      v-if="needs.length || ag.error.value || data?.error"
      class="ag-needs"
    >
      <SettingsRow
        v-if="ag.error.value || data?.error"
        title="读取追更状态失败"
        :description="ag.error.value ?? data?.error ?? ''"
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

    <SeriesSearchBox v-if="data" />

    <PendingList
      v-if="pending.length"
      :episodes="pending"
      :posters="posters"
      :series="seriesById"
      :busy="ag.busy"
      :grabbing-all="ag.grabbingAll.value"
      :stopping="stopping"
      :pack-search="data?.packSearch"
      @grab-best="grabBest"
      @open-series="openSheet"
      @stop="stopTracking"
    />

    <TrackedSeriesList
      v-if="data"
      :tracked="tracked"
      :posters="posters"
      :pending="pendingBySeries"
      :finished="finished"
      @open="openSheet"
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
 * 待处理卡片按剧汇总缺集，统一转存；分集操作收在追剧详情中。
 * ?series= 使用任务句柄，?library= 从媒体库条目创建或复用任务后打开设置面板。
 * keep-alive 下离开页面时关掉面板。
 */
import { computed, onDeactivated, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { confirmDialog } from '@/components/ui'
import { openNetdiskSettings } from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'

import {
  finishedSeriesIds,
  historyEpisodes,
  pendingEpisodes,
  prerequisites,
  statusLine,
  trackedSeries,
} from '../autograb-rules'
import { openAutograbSettings } from '../open-settings'
import { TV_MODE_OPTIONS, optionLabel, prefsSummary } from '../prefs-rules'
import { useAutograb } from '../use-autograb'
import { autograbApi } from '../api'
import { showTrackingError } from '../tracking-error'
import { useSeriesPosters } from '../use-series-posters'
import AutograbEpisodes from './AutograbEpisodes.vue'
import EpisodeGrabSheet from './EpisodeGrabSheet.vue'
import PendingList from './PendingList.vue'
import SeriesGrabSheet from './SeriesGrabSheet.vue'
import SeriesSearchBox from './SeriesSearchBox.vue'
import TrackedSeriesList from './TrackedSeriesList.vue'

const ag = useAutograb()
const data = computed(() => ag.overview.value)
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
/** 已存完的剧 id（在追列表里收起） */
const finished = computed(() => finishedSeriesIds(data.value))
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
watch(
  () => route.query.library,
  async value => {
    if (route.path !== '/autograb') return
    const id = Number(Array.isArray(value) ? value[0] : value)
    if (!Number.isSafeInteger(id) || id <= 0) return
    try {
      const result = await autograbApi().trackLibrary(id)
      await ag.reload()
      if (route.path !== '/autograb' || route.query.library !== value) return
      if (result.status === 'ready') openSheet(result.seriesId)
      void router.replace({
        query: { ...route.query, library: undefined, title: undefined },
      })
    } catch (error) {
      await showTrackingError(error)
    }
  },
  { immediate: true }
)

/** 「另 N 个」打开的单集侧板 */
const episodeKey = ref<string | null>(null)
onDeactivated(() => {
  sheetSeries.value = null
  episodeKey.value = null
})

/** 统一确认选中的缺集，底层逐文件查重并限速转存。 */
async function grabBest(keys: string[]): Promise<void> {
  const ok = await confirmDialog({
    title: `转存 ${keys.length} 集的推荐资源？`,
    content:
      '每集转存匹配分最高的那个文件，存到各自剧的文件夹。存错了可以在「记录」里撤销。',
    okText: '全部转存',
  })
  if (ok) {
    const available = new Set(
      pending.value
        .filter(
          ep =>
            (ep.status === 'found' || ep.status === 'noSpace') &&
            !stopping.has(ep.seriesId)
        )
        .map(ep => ep.key)
    )
    await ag.grabBest(keys.filter(key => available.has(key)))
  }
}

/** 正在确认或取消追剧的剧 id。 */
const stopping = reactive(new Set<number>())

/** 取消整部剧并移除追更记录，保留已转存文件。 */
async function stopTracking(seriesId: number): Promise<void> {
  if (stopping.has(seriesId)) return
  const title = seriesById.value.get(seriesId)?.title ?? '这部剧'
  stopping.add(seriesId)
  try {
    const ok = await confirmDialog({
      title: `取消追「${title}」？`,
      content:
        '移除这部剧的追剧任务及追更记录，停止后续搜索和转存。已转存的网盘文件保留；正在执行的请求可能仍会完成。',
      okText: '取消追剧',
      cancelText: '继续追剧',
    })
    if (ok && (await ag.setSeries(seriesId, { mode: 'off' }))) await ag.reload()
  } finally {
    stopping.delete(seriesId)
  }
}
</script>

<style scoped src="./autograb-view.css"></style>
