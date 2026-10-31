<template>
  <Teleport to="body">
    <Transition name="grab-sheet-fade" appear>
      <div v-if="open" class="grab-sheet-scrim" @click="emit('close')" />
    </Transition>
    <Transition name="grab-sheet-slide" appear>
      <aside
        v-if="open"
        class="grab-sheet"
        role="dialog"
        :aria-label="title"
        @click.stop
      >
        <header class="grab-sheet-head">
          <div class="grab-sheet-text">
            <h2 class="grab-sheet-title">{{ title }}</h2>
            <p v-if="subtitle" class="grab-sheet-sub">{{ subtitle }}</p>
          </div>
          <UiIconButton
            icon="close"
            variant="secondary"
            size="sm"
            label="关闭"
            @click="emit('close')"
          />
        </header>
        <div class="grab-sheet-body"><slot /></div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 追更侧板外壳：从右侧滑出，覆盖在页面上（不插入文档流，页面滚动位置不动）。
 * Esc 与点遮罩都关闭；Esc 走 useEscapeLayer，一次只关最上面一层。
 */
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
}>()
const emit = defineEmits<{ close: [] }>()

useEscapeLayer(
  () => props.open,
  () => emit('close')
)
</script>

<style scoped>
.grab-sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--overlay-scrim-soft);
}

.grab-sheet {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: calc(var(--z-sheet) + 1);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(480px, 100vw);
  padding: var(--space-4) var(--space-5);
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.grab-sheet-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.grab-sheet-text {
  flex: 1;
  min-width: 0;
}

.grab-sheet-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.grab-sheet-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.grab-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  overflow-y: auto;
}

.grab-sheet-fade-enter-active,
.grab-sheet-fade-leave-active,
.grab-sheet-slide-enter-active,
.grab-sheet-slide-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}

.grab-sheet-fade-enter-from,
.grab-sheet-fade-leave-to {
  opacity: 0;
}

.grab-sheet-slide-enter-from,
.grab-sheet-slide-leave-to {
  transform: translateX(100%);
}
</style>
