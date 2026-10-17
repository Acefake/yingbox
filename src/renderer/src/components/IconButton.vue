<template>
  <button type="button" class="yb-icon-button" :class="{ 'is-active': active, 'is-danger': danger, 'is-loading': loading }" :title="label" :aria-label="label" :aria-busy="loading || undefined" :disabled="disabled || loading"><AppIcon :name="loading ? 'refresh' : icon" /></button>
</template>
<script setup lang="ts">
import AppIcon from './AppIcon.vue'
defineProps<{ icon: InstanceType<typeof AppIcon>['$props']['name']; label: string; disabled?: boolean; loading?: boolean; active?: boolean; danger?: boolean }>()
</script>
