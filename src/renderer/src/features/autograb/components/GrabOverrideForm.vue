<template>
  <form class="override" :aria-label="title" @submit.prevent="save">
    <div class="override-row">
      <span class="override-label">方式</span>
      <span class="override-fit">
        <UiSegmented
          v-model="mode"
          :options="modeOptions"
          :label="`${title} · 方式`"
          size="sm"
        />
      </span>
    </div>
    <div class="override-row">
      <span class="override-label">资源</span>
      <span class="override-pills">
        <UiGlassSelect
          v-for="field in selects"
          :key="field.key"
          :model-value="draft[field.key]"
          :options="field.options"
          :label="field.label"
          :text="pillText(field)"
          :active="draft[field.key] !== 'inherit'"
          size="sm"
          @update:model-value="value => setField(field.key, value)"
        />
      </span>
    </div>
    <label class="override-row">
      <span class="override-label">偏好词</span>
      <UiInput
        v-model="draft.prefer"
        size="sm"
        :placeholder="wordsHint(inherit.preferWords, '字幕组或片源，逗号分隔')"
      />
    </label>
    <label class="override-row">
      <span class="override-label">排除词</span>
      <UiInput
        v-model="draft.exclude"
        size="sm"
        placeholder="在全局排除词之外再排除，逗号分隔"
      />
    </label>
    <div class="override-row">
      <span class="override-label">体积（GB）</span>
      <span class="override-size">
        <UiInput
          v-model="draft.min"
          size="sm"
          type="number"
          :placeholder="sizeHint(inherit.minMb, '下限')"
          aria-label="体积下限（GB）"
        />
        <span class="override-sep" aria-hidden="true">–</span>
        <UiInput
          v-model="draft.max"
          size="sm"
          type="number"
          :placeholder="sizeHint(inherit.maxMb, '上限')"
          aria-label="体积上限（GB）"
        />
      </span>
    </div>
    <div class="override-actions">
      <UiButton
        size="sm"
        variant="plain"
        label="取消"
        @click="emit('cancel')"
      />
      <UiButton size="sm" variant="primary" label="保存" @click="save" />
    </div>
  </form>
</template>

<script setup lang="ts">
/**
 * 一部剧 / 电影「单独设」的表单：方式（分段）+ 资源偏好覆盖（取向、首选 / 最低分辨率、杜比视界、HDR、中字用玻璃下拉，
 * 每项多一个「跟随」；偏好词、排除词、体积空着即跟随，占位文字写全局值）。保存时交出方式与覆盖项。
 * 追更面板（剧集）与电影追踪面板共用；全局策略在设置 · 自动追更里改。
 */
import { reactive, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiGlassSelect from '@/components/ui/UiGlassSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import type {
  GrabPrefs,
  GrabPrefsOverride,
} from '../../../../../shared/contract/grab-prefs'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'

import {
  MIN_RESOLUTION_OPTIONS,
  type PrefOption,
  type PrefsDraft,
  RESOLUTION_OPTIONS,
  STRATEGY_OPTIONS,
  SUBS_OPTIONS,
  TRI_OPTIONS,
  draftOfOverride,
  gbText,
  optionLabel,
  overrideOfDraft,
  withInherit,
  wordsText,
} from '../prefs-rules'

type SelectKey =
  | 'strategy'
  | 'resolution'
  | 'minResolution'
  | 'dolbyVision'
  | 'hdr'
  | 'chineseSubs'

interface SelectField {
  key: SelectKey
  label: string
  options: PrefOption<string>[]
}

const props = defineProps<{
  title: string
  modeOptions: PrefOption<GrabMode>[]
  /** 打开时的方式（通常是现在实际生效的方式） */
  initialMode: GrabMode
  /** 现在的覆盖项 */
  value: GrabPrefsOverride
  /** 全局偏好（跟随时的值） */
  inherit: GrabPrefs
}>()
const emit = defineEmits<{
  save: [result: { mode: GrabMode; prefs: GrabPrefsOverride }]
  cancel: []
}>()

const mode = ref<GrabMode>(props.initialMode)
const draft = reactive<PrefsDraft>(draftOfOverride(props.value))

const selectField = (
  key: SelectKey,
  label: string,
  options: PrefOption<string>[]
): SelectField => ({
  key,
  label,
  options: withInherit(options, props.inherit[key]),
})
const selects: SelectField[] = [
  selectField('strategy', '取向', STRATEGY_OPTIONS),
  selectField('resolution', '首选分辨率', RESOLUTION_OPTIONS),
  selectField('minResolution', '最低分辨率', MIN_RESOLUTION_OPTIONS),
  selectField('dolbyVision', '杜比视界', TRI_OPTIONS),
  selectField('hdr', 'HDR', TRI_OPTIONS),
  selectField('chineseSubs', '中文字幕', SUBS_OPTIONS),
]

/** 胶囊文字：跟随时写全局值（灰），单独设了写自己的值 */
function pillText(f: SelectField): string {
  const value = draft[f.key]
  const shown = value === 'inherit' ? props.inherit[f.key] : value
  return `${f.label} · ${optionLabel(f.options, shown)}`
}

function setField(key: SelectKey, value: string): void {
  ;(draft as Record<SelectKey, string>)[key] = value
}

function wordsHint(global: string[], fallback: string): string {
  return global.length ? `跟随全局：${wordsText(global)}` : fallback
}

function sizeHint(global: number | null, fallback: string): string {
  return global != null ? `全局 ${gbText(global)}` : fallback
}

function save(): void {
  emit('save', { mode: mode.value, prefs: overrideOfDraft(draft) })
}
</script>

<style scoped>
.override {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.override-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.override-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.override-fit {
  justify-self: start;
}

.override-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.override-size {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 280px;
}

.override-sep {
  color: var(--text-tertiary);
}

.override-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
