<template>
  <label
    class="ui-checkbox"
    :class="[{ 'is-disabled': disabled }, attrs.class]"
    :style="attrs.style as StyleValue"
  >
    <input
      v-bind="nativeAttrs"
      class="ui-checkbox-native"
      type="checkbox"
      :checked="bound ? Boolean(modelValue) : (nativeAttrs.checked as boolean)"
      :disabled="disabled"
      @change="onChange"
    />
    <span v-if="label || $slots.default" class="ui-checkbox-label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<script setup lang="ts">
/**
 * 复选框：原生 checkbox，勾选色跟随强调色（accent-color），外面包一层 <label> 让文字可点。
 *
 * - v-model 绑定布尔值；也可以 :checked + @change 透传（$event.target 是原生 input）。
 * - class / style 落在 label 上，其余属性交给原生 input。
 * - 文字用 label 属性或默认插槽。
 */
import { type StyleValue, computed, useAttrs } from 'vue'

import { hasModelBinding } from './model-binding'

defineOptions({ inheritAttrs: false })

defineProps<{ modelValue?: boolean; label?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const attrs = useAttrs()
const bound = hasModelBinding()

/** 除 class / style 以外的属性和监听器（含父组件的 @change），交给原生 input */
const nativeAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})

function onChange(event: Event): void {
  if (bound)
    emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<style>
.ui-checkbox {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
}
.ui-checkbox:where(.is-disabled) {
  opacity: 0.5;
  cursor: default;
}
.ui-checkbox-native {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
  min-height: 0;
  margin: 0;
  accent-color: var(--accent);
  cursor: inherit;
}
.ui-checkbox-native:focus-visible {
  outline: none;
  border-radius: var(--radius-xs);
  box-shadow: var(--focus-ring);
}
</style>
