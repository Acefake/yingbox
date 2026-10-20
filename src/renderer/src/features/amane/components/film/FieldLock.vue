<template>
  <!-- 字段被锁定时的小锁图标：刮削时保留用户改过的值 -->
  <span
    v-tooltip="'已锁定，刮削时保留'"
    class="amane-field-lock"
    role="img"
    aria-label="已锁定"
    ><UiIcon name="lock" size="sm"
  /></span>
</template>

<script setup lang="ts">
import { UiIcon, vTooltip } from '@/components/ui'
</script>
