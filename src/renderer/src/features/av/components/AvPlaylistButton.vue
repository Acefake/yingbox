<template>
  <UiIconButton
    :icon="remove ? 'trash' : 'list'"
    :label="remove ? '从片单移除' : '加入片单'"
    variant="overlay"
    size="sm"
    @click.stop="emit('press')"
    @keydown.enter.stop
    @keydown.space.stop
  />
</template>

<script setup lang="ts">
import UiIconButton from '@/components/ui/UiIconButton.vue'

defineProps<{
  /** 片单内显示移除操作。 */
  remove?: boolean
}>()
const emit = defineEmits<{
  /** 请求加入片单或从当前片单移除。 */
  press: []
}>()
</script>
