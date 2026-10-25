<template>
  <input
    class="ui-switch"
    type="checkbox"
    role="switch"
    :checked="modelValue"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @change="onChange"
  />
</template>

<script setup lang="ts">
/**
 * 开关：原生 checkbox（role="switch"），键盘空格即可切换。
 * 开启态是 iOS 式的绿色（--success）；设置窗口里放大到 iOS 尺寸（SettingsPanel）。
 *
 * label 作为无障碍名称；旁边已有可见 <label for> 时可以不传，改传 id。
 */
defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<style>
.ui-switch {
  position: relative;
  flex: 0 0 auto;
  width: 40px;
  height: 24px;
  min-height: 0;
  margin: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--bg-active);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: var(--transition-fast);
}
.ui-switch::after {
  position: absolute;
  top: var(--space-0_5);
  left: var(--space-0_5);
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--text-on-accent);
  box-shadow: var(--shadow-sm);
  content: '';
  transition: transform var(--duration-fast) var(--ease-out);
}
.ui-switch:where(:checked) {
  background: var(--success);
}
.ui-switch:where(:checked)::after {
  transform: translateX(16px);
}
.ui-switch:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-switch:where(:disabled) {
  opacity: 0.4;
  cursor: default;
}
</style>
