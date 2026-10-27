<template>
  <UiGlassSelect
    :model-value="custom ? 'custom' : 'inherit'"
    :options="OPTIONS"
    :label="`${title} 的追更策略`"
    :text="itemPolicyText(custom, effective)"
    :active="custom"
    :columns="1"
    size="sm"
    variant="plain"
    align="right"
    @update:model-value="choose"
  />
</template>

<script setup lang="ts">
/**
 * 追更面板 / 电影追踪每一行的策略胶囊：「跟随 · 全自动」或「单独 · 待确认」，点开选「跟随全局」或「单独设…」。
 * 选跟随发 follow（调用方把方式设回 inherit、清掉覆盖项）；选单独设发 custom（调用方展开 GrabOverrideForm），
 * 已是单独设时再选一次也发 custom，用来重新打开表单。
 */
import UiGlassSelect from '@/components/ui/UiGlassSelect.vue'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'

import { itemPolicyText } from '../prefs-rules'

const props = defineProps<{
  title: string
  /** 单独设了方式或资源偏好（见 prefs-rules isCustom） */
  custom: boolean
  /** 实际生效的方式 */
  effective: GrabMode
}>()
const emit = defineEmits<{ follow: []; custom: [] }>()

const OPTIONS: { value: 'inherit' | 'custom'; label: string; title: string }[] =
  [
    {
      value: 'inherit',
      label: '跟随全局',
      title: '方式和资源偏好都按设置 · 自动追更',
    },
    { value: 'custom', label: '单独设…', title: '单独设方式和资源偏好' },
  ]

function choose(value: 'inherit' | 'custom'): void {
  if (value === 'custom') emit('custom')
  else if (props.custom) emit('follow')
}
</script>
