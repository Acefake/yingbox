<template>
  <UiIconButton
    icon="bookmark"
    variant="secondary"
    size="lg"
    :label="
      tracked
        ? '追更中：打开追更设置'
        : '追更：在片库建这部剧，新集播出后自动搜 115 资源'
    "
    :active="tracked"
    :filled="tracked"
    :loading="busy"
  />
</template>

<script setup lang="ts">
/**
 * 在线剧详情页操作区的「追更」按钮（ADR-0049）：书签图标，样式同「想看」按钮；已在追的实心。
 * 单根元素，让详情头图按插槽给按钮统一尺寸。流程在 useOnlineTracking，由页面接线。
 */
import UiIconButton from '@/components/ui/UiIconButton.vue'

defineProps<{ tracked: boolean; busy: boolean }>()
</script>
