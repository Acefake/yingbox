<template>
  <div class="ag-view">
    <SettingsGroup :footer="usageText">
      <SettingsRow title="剧集追更">
        <template #description>
          <span class="ag-state" role="status" aria-live="polite">
            {{ data ? statusLine(data) : '正在读取追更状态' }}
            <UiLoadingDots v-if="!data || data.running" />
          </span>
        </template>
        <UiButton
          size="sm"
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
      </SettingsRow>
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
      <SettingsRow title="全局策略" :description="policyText">
        <UiButton
          size="sm"
          icon="settings"
          label="修改"
          @click="openAutograbSettings('tv')"
        />
      </SettingsRow>
    </SettingsGroup>

    <PendingList
      v-if="pending.length"
      :episodes="pending"
      :busy="ag.busy"
      @grab="ag.grab"
      @revert="ag.revert"
      @skip="ag.skip"
      @retry="ag.retry"
    />

    <TrackedSeriesList
      v-if="data"
      :tracked="tracked"
      :untracked="untracked"
      :pending="pendingBySeries"
      :busy="tracking"
      @open="openSheet"
      @track="track"
    />

    <SettingsGroup v-if="history.length" title="记录">
      <SettingsRow
        :title="`最近 ${history.length} 集`"
        description="已转存、已入库和跳过的集；追更存进 115 的可以撤销"
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

    <SeriesGrabSheet
      :series-id="sheetSeries"
      :title="sheetTitle"
      @close="sheetSeries = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 自动追更页的「剧集」栏（桌面 /autograb 与 NAS 共用），用设置页同一套玻璃分组（SettingsGroup / SettingsRow）：
 * 第一组是状态（开启 · 上次 / 下次检查、立即检查、总开关）、缺的前置条件（各带就地操作）和全局策略，组脚是今天的 115 用量；
 * 然后是「待处理 → 在追的剧 → 记录」。
 * 每部剧的设置收进侧拉面板（SeriesGrabSheet）；带 ?series=<剧 id>（&title=）进来（播放器「去追更」）时直接打开那部剧的面板。
 * keep-alive 下离开页面时关掉面板。
 */
import { computed, onDeactivated, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
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
import AutograbEpisodes from './AutograbEpisodes.vue'
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
const tracked = computed(() => trackedSeries(data.value))
const untracked = computed(() => untrackedSeries(data.value))
const history = computed(() => historyEpisodes(data.value))
const historyOpen = ref(false)
/** 没单独设的剧怎么追：待确认 · 均衡 */
const policyText = computed(() => {
  const policy = data.value?.policy
  if (!policy) return ''
  return `没单独设的剧：${optionLabel(TV_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})
const usageText = computed(() =>
  data.value
    ? `今天已用 115 查询 ${data.value.today.snaps} 次、转存 ${data.value.today.receives} 次`
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
onDeactivated(() => (sheetSeries.value = null))

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
