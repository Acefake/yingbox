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
        label="偏好"
        :disabled="!data"
        @click="editing = editing === 'global' ? null : 'global'"
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
    <AutograbPrefsForm
      v-if="data && editing === 'global'"
      title="全局追更偏好"
      :value="data.prefs"
      @save="saveGlobal"
      @cancel="editing = null"
    />
    <p v-if="data" class="autograb-usage">
      今天已用 115 查询 {{ data.today.snaps }} 次、转存
      {{ data.today.receives }} 次
    </p>

    <div v-if="data?.series.length" class="autograb-series">
      <div
        v-for="series in data.series"
        :key="series.seriesId"
        class="autograb-row"
      >
        <div class="autograb-row-main">
          <span class="autograb-name">{{ series.title }}</span>
          <span v-if="series.mode !== 'off'" class="autograb-folder">
            {{
              series.cidName ||
              (series.cid ? `文件夹 ${series.cid}` : '设置里的转存目标')
            }}
          </span>
          <span
            v-if="series.mode !== 'off' && overrideSummary(series.prefs)"
            class="autograb-folder"
          >
            {{ overrideSummary(series.prefs) }}
          </span>
          <span
            v-if="series.mode === 'auto' && confirmsLeft(series.confirmed)"
            class="autograb-hint"
          >
            还要手动确认 {{ confirmsLeft(series.confirmed) }} 集才会自动转存
          </span>
        </div>
        <UiButton
          v-if="series.mode !== 'off'"
          size="sm"
          variant="plain"
          icon="folder"
          label="选文件夹"
          :disabled="!data.ready.loggedIn"
          @click="togglePickerFor(series.seriesId)"
        />
        <UiButton
          v-if="series.mode !== 'off'"
          size="sm"
          variant="plain"
          label="偏好"
          @click="toggleSeriesPrefs(series.seriesId)"
        />
        <UiSegmented
          :model-value="series.mode"
          :options="MODE_OPTIONS"
          :label="`${series.title} 的追更方式`"
          size="sm"
          @update:model-value="mode => ag.setSeries(series.seriesId, { mode })"
        />
        <div v-if="picking === series.seriesId" class="autograb-picker">
          <NetdiskFolderPicker
            :start-cid="series.cid || '0'"
            @pick="dir => pickFolder(series.seriesId, dir)"
          />
        </div>
        <div v-if="editing === series.seriesId" class="autograb-picker">
          <AutograbPrefsForm
            :title="`${series.title} 的追更偏好`"
            :value="series.prefs"
            :inherit="data.prefs"
            @save="prefs => saveSeries(series.seriesId, prefs)"
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
 * 追更面板（追剧日历页里展开）：总开关、熔断恢复、立即检查；最近在播的剧逐部选「不追 / 待确认 / 全自动」
 * 和 115 文件夹、每剧偏好覆盖；「偏好」编辑全局的分辨率 / 偏好词 / 排除词 / 体积；
 * 下面是已追剧最近各集的状态与候选（见 AutograbEpisodes），focusKey 指定要定位的一集。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { NetdiskFolderPicker } from '@/features/netdisk'
import type {
  AutograbPrefs,
  AutograbPrefsOverride,
} from '../../../../../shared/contract/autograb-prefs'
import type { Pan115Dir } from '../../../../../shared/contract/pan115'

import {
  MODE_OPTIONS,
  canResume,
  confirmsLeft,
  overviewNotice,
} from '../autograb-rules'
import { overrideSummary } from '../prefs-rules'
import { useAutograb } from '../use-autograb'
import AutograbEpisodes from './AutograbEpisodes.vue'
import AutograbPrefsForm from './AutograbPrefsForm.vue'

defineProps<{ focusKey?: string | null }>()

const ag = useAutograb()
const data = computed(() => ag.overview.value)
const notice = computed(() => (data.value ? overviewNotice(data.value) : null))
const ready = computed(
  () => !!data.value?.ready.loggedIn && !!data.value.ready.pansou
)
const picking = ref<number | null>(null)
/** 正在编辑的偏好：全局 / 某部剧 / 没有 */
const editing = ref<'global' | number | null>(null)

function toggleSeriesPrefs(seriesId: number): void {
  editing.value = editing.value === seriesId ? null : seriesId
}

async function saveGlobal(
  prefs: AutograbPrefs | AutograbPrefsOverride
): Promise<void> {
  editing.value = null
  await ag.setPrefs(prefs as AutograbPrefs)
}

async function saveSeries(
  seriesId: number,
  prefs: AutograbPrefs | AutograbPrefsOverride
): Promise<void> {
  if (await ag.setSeries(seriesId, { prefs })) editing.value = null
}

function togglePickerFor(seriesId: number): void {
  picking.value = picking.value === seriesId ? null : seriesId
}

async function pickFolder(seriesId: number, dir: Pan115Dir): Promise<void> {
  picking.value = null
  await ag.setSeries(seriesId, { cid: dir.cid, cidName: dir.name || '根目录' })
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
