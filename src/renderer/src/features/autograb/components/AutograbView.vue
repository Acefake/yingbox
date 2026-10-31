<template>
  <section class="autograb" aria-label="剧集追更">
    <header class="autograb-head">
      <div class="autograb-head-text">
        <h2 class="autograb-title">剧集追更</h2>
        <p v-if="data" class="autograb-sub">
          {{ statusLine(data) }}
          <UiLoadingDots v-if="data.running" />
        </p>
      </div>
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
    <ul v-if="needs.length" class="autograb-needs">
      <li v-for="need in needs" :key="need.kind" class="autograb-need">
        <span class="autograb-need-text">{{ need.text }}</span>
        <UiButton
          v-if="need.action"
          size="sm"
          :label="need.action.label"
          @click="act(need.action.to)"
        />
      </li>
    </ul>
    <p v-if="data" class="autograb-usage">
      今天已用 115 查询 {{ data.today.snaps }} 次、转存
      {{ data.today.receives }} 次 · 没单独设的剧：{{ policyText }}
    </p>

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
      :busy="tracking"
      @open="openSheet"
      @track="track"
    />

    <section v-if="history.length" class="autograb-history" aria-label="记录">
      <UiButton
        size="sm"
        variant="plain"
        :icon="historyOpen ? 'chevronUp' : 'chevronDown'"
        :label="`记录 · ${history.length} 集`"
        :aria-expanded="historyOpen"
        @click="historyOpen = !historyOpen"
      />
      <AutograbEpisodes
        v-if="historyOpen"
        :episodes="history"
        :busy="ag.busy"
        @grab="ag.grab"
        @revert="ag.revert"
        @skip="ag.skip"
        @retry="ag.retry"
      />
    </section>

    <SeriesGrabSheet
      :series-id="sheetSeries"
      :title="sheetTitle"
      @close="sheetSeries = null"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页的「剧集」栏（桌面 /autograb 与 NAS 共用）：页头状态句（开启 · 上次 / 下次检查）、总开关、立即检查；
 * 前置条件卡（没登录 115、没填 PanSou、暂停各带就地操作）；然后按「待处理 → 在追的剧 → 记录」排。
 * 每部剧的设置收进侧板（SeriesGrabSheet）；带 ?series=<剧 id> 进来（播放器「去追更」）时直接打开那部剧的侧板。
 * keep-alive 下离开页面时关掉侧板。
 */
import { computed, onDeactivated, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { toast } from '@/components/ui/toast'
import { openNetdiskSettings } from '@/features/netdisk'
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
const tracked = computed(() => trackedSeries(data.value))
const untracked = computed(() => untrackedSeries(data.value))
const history = computed(() => historyEpisodes(data.value))
const historyOpen = ref(false)
/** 全局策略的一句话：全自动 · 均衡 · 4K */
const policyText = computed(() => {
  const policy = data.value?.policy
  if (!policy) return ''
  return `${optionLabel(TV_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})

/** 前置条件卡的就地操作 */
function act(to: 'settings-pan' | 'resume'): void {
  if (to === 'resume') void ag.resume()
  else openNetdiskSettings()
}

// 侧板：点在追的剧的行，或带 ?series= 进来
const sheetSeries = ref<number | null>(null)
/** 深链带来的剧名（总览里没有这部剧时侧板用） */
const sheetTitle = ref<string | undefined>()
const route = useRoute()
const router = useRouter()

function openSheet(seriesId: number): void {
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

// 一键追更：先按待确认追（要全自动再进侧板改）
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

<style scoped>
.autograb {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
.autograb-usage {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.autograb-notice {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--warning);
}

.autograb-needs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.autograb-need {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.autograb-need-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--warning);
}

.autograb-history {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}
</style>
