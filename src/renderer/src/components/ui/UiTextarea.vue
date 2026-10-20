<template>
  <textarea
    v-if="bound"
    ref="el"
    v-model="model"
    class="ui-field ui-textarea"
    :class="{ 'is-autosize': autosize, 'is-invalid': invalid }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
    @input="resize"
  />
  <textarea
    v-else
    ref="el"
    class="ui-field ui-textarea"
    :class="{ 'is-autosize': autosize, 'is-invalid': invalid }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
    @input="resize"
  />
</template>

<script setup lang="ts">
/**
 * 多行文本框。直接是原生 <textarea>，class 和其余属性、事件都落在它上面。
 *
 * - 既可以 v-model，也可以 :value + @input 透传（见 model-binding.ts）。
 * - autosize：高度随内容增长，最少 rows 行；需要上限时由页面 class 设 max-height。
 * - 父组件需要 focus() 时拿组件 ref 调用即可（已 defineExpose）。
 */
import { nextTick, onMounted, ref, watch } from 'vue'

import { hasModelBinding } from './model-binding'

const props = withDefaults(
  defineProps<{
    rows?: number | string
    placeholder?: string
    autosize?: boolean
    disabled?: boolean
    invalid?: boolean
  }>(),
  { rows: 3 }
)
const model = defineModel<string | null | undefined>()

const bound = hasModelBinding()
const el = ref<HTMLTextAreaElement | null>(null)

/** autosize 时按内容撑高：先清空高度再取 scrollHeight，加上边框 */
function resize(): void {
  const textarea = el.value
  if (!props.autosize || !textarea) return
  textarea.style.height = 'auto'
  const border = textarea.offsetHeight - textarea.clientHeight
  textarea.style.height = `${textarea.scrollHeight + border}px`
}

// 外部改了值（例如发送后清空）也要重新计算高度
watch(model, () => nextTick(resize))
onMounted(resize)

defineExpose({
  /** 原生 textarea 元素 */
  el,
  focus: (options?: Parameters<HTMLElement['focus']>[0]) =>
    el.value?.focus(options),
  blur: () => el.value?.blur(),
  select: () => el.value?.select(),
})
</script>

<style>
:where(.ui-textarea)::placeholder {
  color: var(--text-quaternary);
}
:where(.ui-textarea.is-autosize) {
  overflow-y: auto;
  resize: none;
}
</style>
