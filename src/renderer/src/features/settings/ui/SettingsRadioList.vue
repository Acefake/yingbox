<template>
  <div class="settings-radio-list" role="radiogroup" :aria-label="label">
    <label
      v-for="opt in options"
      :key="opt.value"
      class="settings-radio"
      :class="{ 'is-active': modelValue === opt.value }"
    >
      <UiRadio
        class="settings-radio-input"
        :name="name"
        :value="opt.value"
        :checked="modelValue === opt.value"
        @change="emit('update:modelValue', opt.value)"
      />
      <span class="settings-radio-text">
        <span class="settings-radio-title">{{ opt.label }}</span>
        <span v-if="opt.desc" class="settings-radio-desc">{{ opt.desc }}</span>
      </span>
    </label>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
/**
 * 带说明的单选列表（如「刮削服务」「播放引擎」）。原生 radio，方向键可切换；
 * 每项一行：圆形单选 + 标题 + 一行说明。
 */
import { useId } from 'vue'

import UiRadio from '@/components/ui/UiRadio.vue'

export interface SettingsRadioOption<V extends string = string> {
  value: V
  label: string
  desc?: string
}

defineProps<{
  modelValue: T
  options: SettingsRadioOption<T>[]
  label: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const name = `settings-radio-${useId()}`
</script>

<style scoped>
.settings-radio-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  /* 抵消每项的内边距，让单选圈与上下行的文字左对齐 */
  margin: 0 calc(-1 * var(--space-2));
}
.settings-radio {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-fast);
}
.settings-radio:hover {
  background: var(--bg-glass-hover);
}
.settings-radio-input {
  margin-top: 1px;
}
.settings-radio-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
}
.settings-radio-title {
  color: var(--text-primary);
  font-size: var(--text-sm);
}
.settings-radio.is-active .settings-radio-title {
  font-weight: var(--font-weight-medium);
}
.settings-radio-desc {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
</style>
