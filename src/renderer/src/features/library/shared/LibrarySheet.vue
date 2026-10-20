<template>
  <Teleport to="body">
    <Transition name="lib-sheet">
      <div
        v-if="open"
        class="lib-sheet-backdrop"
        @click.self="emit('close')"
        @keydown.esc.stop="emit('close')"
      >
        <section
          ref="panel"
          class="lib-sheet"
          :class="`is-${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <DialogTitlebar :title="title" :icon="icon" @close="emit('close')">
            <template v-if="$slots.actions" #actions>
              <slot name="actions" />
            </template>
          </DialogTitlebar>
          <div class="lib-sheet-body custom-scrollbar">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="lib-sheet-footer">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 媒体库的模态面板（设置、修正匹配、整理预览）：居中浮起、背后轻遮罩，Esc 或点遮罩关闭。
 * 打开时把焦点移进面板，键盘用户不会落在背后的海报墙上。
 */
import { nextTick, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import type { IconName } from '@/components/ui/icons'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    icon?: IconName
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' }
)
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  async open => {
    if (!open) return
    await nextTick()
    panel.value?.focus()
  }
)
</script>

<style scoped>
.lib-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: var(--space-8);
  background: var(--overlay-scrim-soft);
}
.lib-sheet {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(760px, 100%);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  outline: none;
}
.lib-sheet.is-lg {
  width: min(960px, 100%);
}
.lib-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2) var(--space-6) var(--space-6);
}
.lib-sheet-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--separator);
}
.lib-sheet-enter-active,
.lib-sheet-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.lib-sheet-enter-active .lib-sheet,
.lib-sheet-leave-active .lib-sheet {
  transition: transform var(--duration-normal) var(--ease-out);
}
.lib-sheet-enter-from,
.lib-sheet-leave-to {
  opacity: 0;
}
.lib-sheet-enter-from .lib-sheet,
.lib-sheet-leave-to .lib-sheet {
  transform: scale(0.97);
}
</style>
