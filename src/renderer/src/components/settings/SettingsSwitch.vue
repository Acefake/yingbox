<template>
  <input
    class="settings-switch"
    type="checkbox"
    role="switch"
    :checked="modelValue"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @change="
      emit('update:modelValue', ($event.target as HTMLInputElement).checked)
    "
  />
</template>

<script setup lang="ts">
/**
 * 开关：原生 checkbox（role="switch"），键盘空格即可切换。
 * 开启态用强调色——这是界面里少数允许出现强调色的地方。
 */
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<style scoped>
.settings-switch {
  position: relative;
  flex: 0 0 auto;
  width: 38px;
  height: 22px;
  margin: 0;
  border-radius: var(--radius-full);
  background: var(--bg-active);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: var(--transition-fast);
}
.settings-switch::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--text-on-accent);
  box-shadow: var(--shadow-sm);
  content: '';
  transition: transform var(--duration-fast) var(--ease-out);
}
.settings-switch:checked {
  background: var(--accent);
}
.settings-switch:checked::after {
  transform: translateX(16px);
}
.settings-switch:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.settings-switch:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
