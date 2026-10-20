<template>
  <input class="ui-radio" type="radio" />
</template>

<script setup lang="ts">
/**
 * 单选圆点：原生 radio，选中色跟随强调色（accent-color）。
 * name / value / checked / @change 等属性和事件都直接落在原生 input 上；
 * 整行的布局和选中背景由外层（如 SettingsRadioList 的 <label>）负责。
 */
</script>

<style>
.ui-radio {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
  min-height: 0;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.ui-radio:where(:focus-visible) {
  outline: none;
  border-radius: var(--radius-full);
  box-shadow: var(--focus-ring);
}
</style>
