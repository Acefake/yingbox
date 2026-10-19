<template>
  <button type="button" :class="primary ? 'yb-btn-primary' : 'yb-btn-soft'" class="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-yb-md px-3 py-1.5 text-sm leading-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yb-accent" :disabled="disabled">
    <AppIcon :name="icon" size="sm" /><span>{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{
  icon: InstanceType<typeof AppIcon>['$props']['name']
  label: string
  primary?: boolean
  disabled?: boolean
}>()
</script>
