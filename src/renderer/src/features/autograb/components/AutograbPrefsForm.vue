<template>
  <form class="ag-prefs" :aria-label="title" @submit.prevent="save">
    <div class="ag-prefs-row">
      <span class="ag-prefs-label">首选分辨率</span>
      <UiSegmented
        v-model="draft.resolution"
        :options="resolutionOptions"
        :label="`${title} · 首选分辨率`"
        size="sm"
      />
    </div>
    <label class="ag-prefs-row">
      <span class="ag-prefs-label">偏好词</span>
      <UiInput
        v-model="draft.prefer"
        size="sm"
        :placeholder="
          placeholder(inherit?.preferWords, '字幕组或片源，逗号分隔，命中加分')
        "
      />
    </label>
    <label class="ag-prefs-row">
      <span class="ag-prefs-label">排除词</span>
      <UiInput
        v-model="draft.exclude"
        size="sm"
        :placeholder="
          inherit
            ? '在全局排除词之外再排除，逗号分隔'
            : '命中就不要，逗号分隔（预告、枪版等已内置）'
        "
      />
    </label>
    <div class="ag-prefs-row">
      <span class="ag-prefs-label">体积（GB）</span>
      <span class="ag-prefs-size">
        <UiInput
          v-model="draft.min"
          size="sm"
          type="number"
          :placeholder="sizePlaceholder(inherit?.minMb, '下限 0.08')"
          aria-label="体积下限（GB）"
        />
        <span class="ag-prefs-sep" aria-hidden="true">–</span>
        <UiInput
          v-model="draft.max"
          size="sm"
          type="number"
          :placeholder="sizePlaceholder(inherit?.maxMb, '上限 25')"
          aria-label="体积上限（GB）"
        />
      </span>
    </div>
    <div class="ag-prefs-actions">
      <UiButton
        v-if="inherit"
        size="sm"
        variant="plain"
        label="全部跟随全局"
        @click="emit('save', {})"
      />
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
 * 追更偏好表单：首选分辨率、偏好词、排除词、体积上下限。
 * 不传 inherit 时编辑全局偏好；传了（全局偏好）时编辑一部剧的覆盖项：分辨率多一个「跟随全局」，
 * 空着的字段跟随全局，占位文字显示全局值。保存时把表单换成偏好 / 覆盖项交给父组件。
 */
import { computed, reactive } from 'vue'

import { UiButton, UiInput, UiSegmented } from '@/components/ui'
import type {
  AutograbPrefs,
  AutograbPrefsOverride,
} from '../../../../../shared/contract/autograb-prefs'

import {
  type PrefsDraft,
  RESOLUTION_OPTIONS,
  draftOfOverride,
  draftOfPrefs,
  gbText,
  overrideOfDraft,
  prefsOfDraft,
  wordsText,
} from '../prefs-rules'

const props = defineProps<{
  title: string
  /** 全局偏好时为完整偏好；每剧时为它的覆盖项 */
  value: AutograbPrefs | AutograbPrefsOverride
  /** 编辑每剧覆盖时传入全局偏好 */
  inherit?: AutograbPrefs
}>()
const emit = defineEmits<{
  save: [prefs: AutograbPrefs | AutograbPrefsOverride]
  cancel: []
}>()

const draft = reactive<PrefsDraft>(
  props.inherit
    ? draftOfOverride(props.value)
    : draftOfPrefs(props.value as AutograbPrefs)
)

const resolutionOptions = computed(() =>
  props.inherit
    ? [
        {
          value: 'inherit' as const,
          label: '跟随',
          title: `跟随全局（${props.inherit.resolution === 'any' ? '任意' : props.inherit.resolution}）`,
        },
        ...RESOLUTION_OPTIONS,
      ]
    : RESOLUTION_OPTIONS
)

function placeholder(global: string[] | undefined, fallback: string): string {
  return global?.length ? `跟随全局：${wordsText(global)}` : fallback
}

function sizePlaceholder(
  global: number | null | undefined,
  fallback: string
): string {
  return props.inherit && global != null ? `全局 ${gbText(global)}` : fallback
}

function save(): void {
  emit('save', props.inherit ? overrideOfDraft(draft) : prefsOfDraft(draft))
}
</script>

<style scoped>
.ag-prefs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.ag-prefs-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.ag-prefs-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.ag-prefs-size {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 280px;
}

.ag-prefs-sep {
  color: var(--text-tertiary);
}

.ag-prefs-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
