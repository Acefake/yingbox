<template>
  <div
    class="ui-field ui-input"
    :class="[
      `is-${size}`,
      `is-${variant}`,
      {
        'is-disabled': disabled,
        'is-invalid': invalid,
        'is-readonly':
          nativeAttrs.readonly != null && nativeAttrs.readonly !== false,
      },
      attrs.class,
    ]"
    :style="attrs.style as StyleValue"
  >
    <span v-if="icon || $slots.leading" class="ui-field-leading">
      <slot name="leading"><UiIcon v-if="icon" :name="icon" size="sm" /></slot>
    </span>
    <input
      v-if="bound"
      ref="inputEl"
      v-model="model"
      v-bind="nativeAttrs"
      class="ui-input-native"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
    />
    <input
      v-else
      ref="inputEl"
      v-bind="nativeAttrs"
      class="ui-input-native"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
    />
    <UiIconButton
      v-if="clearable && hasValue && !disabled"
      class="ui-input-clear"
      icon="close"
      size="sm"
      :label="clearLabel"
      @click="clear"
    />
    <slot name="trailing" />
  </div>
</template>

<script setup lang="ts">
/**
 * 单行文本框。外壳（边框、底色、焦点环）在 div 上，原生 <input> 在里面。
 *
 * - class / style 落在外壳上，其余属性（aria-label、maxlength、id、readonly、autocomplete…）
 *   和事件（@keydown、@input、@blur…）原样交给原生 input。
 * - 既可以 v-model，也可以 :value + @input 透传（见 model-binding.ts）。
 * - clearable：有内容时右侧出现清除按钮，点击后清空、触发 clear 事件并把焦点放回输入框。
 * - icon / #leading：左侧图标（如搜索）；#trailing：右侧附加内容。
 * - variant：default 有描边，用在表单里；filled 无描边浅灰底，用在工具栏搜索框。
 * - 父组件需要 focus() 时拿组件 ref 调用即可（已 defineExpose）。
 */
import { type StyleValue, computed, ref, useAttrs } from 'vue'

import type { IconName } from './icons'
import { hasModelBinding } from './model-binding'
import UiIcon from './UiIcon.vue'
import UiIconButton from './UiIconButton.vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    type?: string
    placeholder?: string
    size?: 'sm' | 'md'
    variant?: 'default' | 'filled'
    icon?: IconName
    clearable?: boolean
    clearLabel?: string
    disabled?: boolean
    invalid?: boolean
  }>(),
  { type: 'text', size: 'md', variant: 'default', clearLabel: '清除' }
)
const emit = defineEmits<{ clear: [] }>()
const model = defineModel<string | number | null | undefined>()

const attrs = useAttrs()
const bound = hasModelBinding()
const inputEl = ref<HTMLInputElement | null>(null)

/** 除 class / style 以外的属性和监听器，交给原生 input */
const nativeAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})

const hasValue = computed(() => {
  const value = bound ? model.value : attrs.value
  return value != null && value !== ''
})

function clear(): void {
  if (bound) model.value = ''
  emit('clear')
  inputEl.value?.focus()
}

defineExpose({
  /** 原生 input 元素 */
  el: inputEl,
  focus: (options?: Parameters<HTMLElement['focus']>[0]) =>
    inputEl.value?.focus(options),
  blur: () => inputEl.value?.blur(),
  select: () => inputEl.value?.select(),
})
</script>

<style>
.ui-input-native {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  appearance: none;
  -webkit-appearance: none;
}
.ui-input-native::placeholder {
  color: var(--text-quaternary);
}
.ui-input-native:focus-visible {
  outline: none;
}
.ui-input-native::-webkit-search-cancel-button {
  display: none;
}
.ui-input-clear {
  --ib-size: 20px;
  margin-right: calc(var(--space-1) * -1);
  border-radius: var(--radius-full);
}
.ui-input:where(.is-sm) .ui-input-clear {
  --ib-size: 18px;
}
</style>
