<template>
  <SettingsGroup :title="`${kindText}资源偏好`" :footer="FOOTER">
    <SettingsRow
      v-for="field in selects"
      :key="field.key"
      :title="field.label"
      :description="field.description"
    >
      <UiGlassSelect
        :model-value="prefs[field.key]"
        :options="field.options"
        :label="`${kindText} · ${field.label}`"
        :text="optionLabel(field.options, prefs[field.key])"
        size="sm"
        align="right"
        @update:model-value="value => saveField(field.key, value)"
      />
    </SettingsRow>
    <SettingsRow title="体积" :description="sizeDescription">
      <span class="prefs-size">
        <UiInput
          :model-value="gbText(prefs.minMb)"
          size="sm"
          type="number"
          placeholder="下限"
          :aria-label="`${kindText}体积下限（GB）`"
          @change="event => savePrefs({ min: inputValue(event) })"
        />
        <span class="prefs-sep" aria-hidden="true">–</span>
        <UiInput
          :model-value="gbText(prefs.maxMb)"
          size="sm"
          type="number"
          placeholder="上限"
          :aria-label="`${kindText}体积上限（GB）`"
          @change="event => savePrefs({ max: inputValue(event) })"
        />
        <span class="prefs-unit">GB</span>
      </span>
    </SettingsRow>
    <SettingsRow title="偏好词" description="字幕组或片源，命中加分" stacked>
      <UiInput
        :model-value="wordsText(prefs.preferWords)"
        size="sm"
        placeholder="如 ADWeb、WEB-DL，逗号分隔"
        :aria-label="`${kindText}偏好词`"
        @change="event => savePrefs({ prefer: inputValue(event) })"
      />
    </SettingsRow>
    <SettingsRow title="排除词" description="命中就不要" stacked>
      <UiInput
        :model-value="wordsText(prefs.excludeWords)"
        size="sm"
        placeholder="预告、枪版等已内置，逗号分隔"
        :aria-label="`${kindText}排除词`"
        @change="event => savePrefs({ exclude: inputValue(event) })"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 自动追更里一种媒体的资源偏好：取向、首选 / 最低分辨率、杜比视界、HDR、中文字幕（玻璃下拉，即选即存），
 * 体积范围、偏好词、排除词（输入框改完离开即存）。每部剧 / 电影可以在面板里「单独设」覆盖这些值。
 */
import { computed } from 'vue'

import UiGlassSelect from '@/components/ui/UiGlassSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  MIN_RESOLUTION_OPTIONS,
  RESOLUTION_OPTIONS,
  STRATEGY_OPTIONS,
  SUBS_OPTIONS,
  TRI_OPTIONS,
  gbText,
  optionLabel,
  patchPrefs,
  wordsText,
} from '@/features/autograb'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type { GrabPrefs } from '../../../../../shared/contract/grab-prefs'
import type { GrabPolicyPatch } from '../../../../../shared/contract/grab-policy'

type SelectKey =
  | 'strategy'
  | 'resolution'
  | 'minResolution'
  | 'dolbyVision'
  | 'hdr'
  | 'chineseSubs'

const FOOTER =
  '画质优先不等更好的版本：先存首发版本，之后由洗版换成更清楚的。认不出分辨率的文件不受最低分辨率限制。'

const props = defineProps<{
  kind: 'tv' | 'movie'
  prefs: GrabPrefs
  /** 改策略；成功为 true */
  save: (patch: GrabPolicyPatch) => Promise<boolean>
}>()

const kindText = computed(() => (props.kind === 'tv' ? '剧集' : '电影'))
const sizeDescription = computed(() =>
  props.kind === 'tv' ? '空着按 0.08–25 GB' : '空着按 0.5–80 GB'
)

const selects: {
  key: SelectKey
  label: string
  description?: string
  options: { value: string; label: string; title?: string }[]
}[] = [
  { key: 'strategy', label: '取向', options: STRATEGY_OPTIONS },
  {
    key: 'resolution',
    label: '首选分辨率',
    description: '同样能用时优先这个',
    options: RESOLUTION_OPTIONS,
  },
  {
    key: 'minResolution',
    label: '最低分辨率',
    description: '低于它的不要',
    options: MIN_RESOLUTION_OPTIONS,
  },
  { key: 'dolbyVision', label: '杜比视界', options: TRI_OPTIONS },
  { key: 'hdr', label: 'HDR', options: TRI_OPTIONS },
  { key: 'chineseSubs', label: '中文字幕', options: SUBS_OPTIONS },
]

/** 改一项偏好：拼出整份偏好再存（策略里的 prefs 是整份替换） */
async function savePrefs(
  patch: Parameters<typeof patchPrefs>[1]
): Promise<boolean> {
  return props.save({ prefs: patchPrefs(props.prefs, patch) })
}

/** 下拉选了一项（值来自这一项自己的选项表） */
function saveField(key: SelectKey, value: string): void {
  void savePrefs({ [key]: value } as Partial<GrabPrefs>)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<style scoped>
.prefs-size {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 240px;
}

.prefs-sep,
.prefs-unit {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
