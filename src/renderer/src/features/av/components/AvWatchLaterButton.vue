<template>
  <UiIconButton
    icon="bookmark"
    variant="overlay"
    size="sm"
    :class="{ 'is-on': saved }"
    :label="saved ? '从待看移除' : '加入待看'"
    :active="saved"
    :filled="saved"
    @click.stop="emit('toggle')"
    @keydown.enter.stop
    @keydown.space.stop
  />
</template>

<script setup lang="ts">
import UiIconButton from '@/components/ui/UiIconButton.vue'

defineProps<{
  /** 当前资源是否在待看列表中。 */
  saved: boolean
}>()
const emit = defineEmits<{
  /** 切换当前资源的待看状态。 */
  toggle: []
}>()
</script>
