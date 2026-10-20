<template>
  <Modal v-bind="$attrs" :open="open" :closable="false" class="app-modal" @cancel="$emit('cancel', $event)" @update:open="$emit('update:open', $event)">
    <template #title><DialogTitlebar :title="title" :icon="icon" @close="cancel" /></template>
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </Modal>
</template>

<script setup lang="ts">
import { Modal } from 'ant-design-vue'
import DialogTitlebar from './DialogTitlebar.vue'
import type { IconName } from '@/components/ui/icons'
defineOptions({ inheritAttrs: false })
defineProps<{ open?: boolean; title?: string; icon?: IconName }>()
const emit = defineEmits<{ cancel: [event: MouseEvent]; 'update:open': [value: boolean] }>()
function cancel(event: MouseEvent): void { emit('update:open', false); emit('cancel', event) }
</script>
