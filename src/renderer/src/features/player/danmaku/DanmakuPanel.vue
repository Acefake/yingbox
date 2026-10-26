<template>
  <div class="danmaku-panel" @click.stop @contextmenu.stop>
    <DialogTitlebar title="弹幕" icon="subtitle" @close="emit('close')" />
    <div class="danmaku-panel-tabs">
      <UiSegmented v-model="tab" size="sm" label="弹幕面板" :options="tabs" />
    </div>

    <div v-if="!state.ready.value" class="danmaku-panel-setup">
      <p>
        弹幕来自弹弹play 开放平台，需要先填写你自己申请的 AppId 和 AppSecret。
      </p>
      <UiButton size="sm" icon="settings" label="去设置" @click="goSettings" />
    </div>

    <div v-else-if="tab === 'settings'" class="danmaku-panel-body">
      <label class="danmaku-row">
        <span>显示弹幕</span>
        <UiSwitch v-model="enabled" label="显示弹幕" />
      </label>
      <label class="danmaku-row">
        <span>不透明度</span>
        <input
          v-model.number="opacity"
          class="danmaku-range"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          aria-label="不透明度"
        />
        <span class="danmaku-value">{{ Math.round(opacity * 100) }}%</span>
      </label>
      <div class="danmaku-row">
        <span>显示区域</span>
        <UiSegmented
          v-model="area"
          size="sm"
          label="显示区域"
          :options="areas"
        />
      </div>
      <div class="danmaku-row">
        <span>速度</span>
        <UiSegmented v-model="speed" size="sm" label="速度" :options="speeds" />
      </div>
      <label class="danmaku-row">
        <span>字号</span>
        <input
          v-model.number="fontSize"
          class="danmaku-range"
          type="range"
          min="14"
          max="40"
          step="1"
          aria-label="字号"
        />
        <span class="danmaku-value">{{ fontSize }}</span>
      </label>
      <div class="danmaku-row is-stacked">
        <span>屏蔽词</span>
        <UiTextarea
          v-model="blockWords"
          rows="3"
          autosize
          aria-label="屏蔽词"
          placeholder="每行一个；/正则/ 也可以"
        />
      </div>
      <p class="danmaku-source">
        <template v-if="state.source.value">
          弹弹play · {{ state.source.value.animeTitle }}
          {{ state.source.value.episodeTitle }} ·
          {{ state.count.value.toLocaleString() }} 条
        </template>
        <template v-else>{{
          state.message.value || '还没有加载弹幕'
        }}</template>
      </p>
    </div>

    <DanmakuSearch
      v-else
      :query="state.query.value"
      :results="state.results.value"
      :searching="state.searching.value"
      :message="state.searchMessage.value"
      @update:query="emit('query', $event)"
      @search="emit('search')"
      @pick="onPick"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 弹幕面板（控制栏「弹」右键 / 长按打开）：外观设置（全局记住）与「搜索弹幕」手动绑定。
 * 状态都在 useDanmaku，这里只负责展示和改设置。
 */
import { ref } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useSetting } from '@/features/settings'

import type { DanmakuAnime } from '../../../../../shared/contract/danmaku'
import type { DanmakuArea, DanmakuSpeed } from './danmaku-rules'
import { openDanmakuSettings } from './danmaku-store'
import type { DanmakuState } from './use-danmaku'
import DanmakuSearch from './DanmakuSearch.vue'

defineProps<{ state: DanmakuState }>()
const emit = defineEmits<{
  close: []
  /** 搜索框内容变化 */
  query: [value: string]
  search: []
  bind: [anime: DanmakuAnime, episode: DanmakuAnime['episodes'][number]]
}>()

// 面板挂载即打开（父组件 v-if），Esc 只关面板
useEscapeLayer(
  () => true,
  () => emit('close')
)

type Tab = 'settings' | 'search'
const tab = ref<Tab>('settings')
const tabs: SegmentedOption<Tab>[] = [
  { value: 'settings', label: '设置' },
  { value: 'search', label: '搜索弹幕' },
]
const areas: SegmentedOption<DanmakuArea>[] = [
  { value: 'quarter', label: '1/4' },
  { value: 'half', label: '半屏' },
  { value: 'full', label: '全屏' },
]
const speeds: SegmentedOption<DanmakuSpeed>[] = [
  { value: 'slow', label: '慢' },
  { value: 'normal', label: '中' },
  { value: 'fast', label: '快' },
]

const enabled = useSetting('danmaku.enabled')
const opacity = useSetting('danmaku.opacity')
const area = useSetting('danmaku.area')
const speed = useSetting('danmaku.speed')
const fontSize = useSetting('danmaku.fontSize')
const blockWords = useSetting('danmaku.blockWords')

const goSettings = (): void => {
  emit('close')
  openDanmakuSettings()
}

const onPick = (
  anime: DanmakuAnime,
  episode: DanmakuAnime['episodes'][number]
): void => {
  tab.value = 'settings'
  emit('bind', anime, episode)
}
</script>

<style scoped>
.danmaku-panel {
  position: absolute;
  right: var(--space-3);
  bottom: 56px; /* style-tokens: layout（避开底部控制栏） */
  z-index: var(--z-popover);
  width: min(340px, 86vw);
  /* 86vw 按整个窗口算；播放器缩小（如把播放器窗口拉小）时按播放器宽度兜底，不溢出 */
  max-width: calc(100% - 2 * var(--space-3));
  max-height: min(480px, 70vh);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  overflow: hidden;
}

.danmaku-panel-tabs {
  padding: 0 var(--space-3) var(--space-2);
}

.danmaku-panel-setup {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.danmaku-panel-setup p {
  margin: 0;
}

.danmaku-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3) var(--space-3);
}

.danmaku-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-xs);
}

.danmaku-row > span:first-child {
  flex: 0 0 auto;
  width: 4.5em;
  color: var(--text-secondary);
}

.danmaku-row.is-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.danmaku-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.danmaku-value {
  flex: 0 0 auto;
  min-width: 3em;
  text-align: right;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.danmaku-source {
  margin: 0;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}
</style>
