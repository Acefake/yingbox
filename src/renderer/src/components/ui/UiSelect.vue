<template>
  <div
    class="ui-field ui-select"
    :class="[
      `is-${size}`,
      { 'is-disabled': disabled, 'is-invalid': invalid },
      attrs.class,
    ]"
    :style="attrs.style as StyleValue"
  >
    <select
      v-if="bound"
      ref="selectEl"
      v-model="model"
      v-bind="nativeAttrs"
      class="ui-select-native"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
    >
      <slot>
        <option
          v-for="option in options"
          :key="String(option.value)"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </slot>
    </select>
    <select
      v-else
      ref="selectEl"
      v-bind="nativeAttrs"
      class="ui-select-native"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
    >
      <slot>
        <option
          v-for="option in options"
          :key="String(option.value)"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </slot>
    </select>
    <UiIcon class="ui-select-chevron" name="chevronDown" size="sm" />
  </div>
</template>

<script setup lang="ts">
/**
 * 下拉选择：原生 <select>（系统菜单、键盘与无障碍都由系统负责），外观与 UiInput 一致，
 * 右侧画 chevronDown。
 *
 * - 选项用 options 传 [{ value, label }]，或者在默认插槽里写 <option>。
 * - class / style 落在外壳上，其余属性（aria-label、id…）和事件（@change、@focus…）交给原生 select。
 * - 既可以 v-model（选项值保持原类型），也可以 :value + @change 透传（见 model-binding.ts）。
 */
import { type StyleValue, computed, ref, useAttrs } from 'vue'

import { hasModelBinding } from './model-binding'
import UiIcon from './UiIcon.vue'

export interface SelectOption {
  value: string | number
  label: string
  disabled?: boolean
}

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    options?: SelectOption[]
    size?: 'sm' | 'md'
    disabled?: boolean
    invalid?: boolean
  }>(),
  { options: () => [], size: 'md' }
)
// 原生 select 的 v-model 会保留 option 绑定值的原类型，这里不限定
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = defineModel<any>()

const attrs = useAttrs()
const bound = hasModelBinding()
const selectEl = ref<HTMLSelectElement | null>(null)

/** 除 class / style 以外的属性和监听器，交给原生 select */
const nativeAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})

defineExpose({
  /** 原生 select 元素 */
  el: selectEl,
  focus: (options?: Parameters<HTMLElement['focus']>[0]) =>
    selectEl.value?.focus(options),
})
</script>

<style>
.ui-select-native {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 calc(var(--space-3) + var(--icon-sm) + var(--space-1)) 0
    var(--space-3);
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-overflow: ellipsis;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.ui-select-native:focus-visible {
  outline: none;
}
.ui-select-native:disabled {
  cursor: default;
}
.ui-select:where(.is-sm) .ui-select-native {
  padding-left: var(--space-2);
  padding-right: calc(var(--space-2) + var(--icon-sm) + var(--space-1));
}
.ui-select-chevron {
  position: absolute;
  top: 50%;
  right: var(--space-3);
  color: var(--text-tertiary);
  transform: translateY(-50%);
  pointer-events: none;
}
.ui-select:where(.is-sm) .ui-select-chevron {
  right: var(--space-2);
}
</style>
