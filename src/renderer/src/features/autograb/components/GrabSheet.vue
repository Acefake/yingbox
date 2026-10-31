<template>
  <Teleport to="body">
    <Transition name="grab-sheet-fade" appear>
      <div v-if="open" class="grab-sheet-scrim" @click="emit('close')" />
    </Transition>
    <Transition name="grab-sheet-slide" appear>
      <aside
        v-if="open"
        class="grab-sheet yb-glass"
        role="dialog"
        :aria-label="title"
        @click.stop
      >
        <DialogTitlebar :title="title" @close="emit('close')" />
        <div class="grab-sheet-body custom-scrollbar">
          <p v-if="subtitle" class="grab-sheet-sub">{{ subtitle }}</p>
          <slot />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 追更侧拉面板：玻璃浮层（同后台任务面板的材质与外形），从右侧滑出，离窗口边留出外壳间距，
 * 覆盖在页面上（不插入文档流，页面滚动位置不动）。标题栏用 DialogTitlebar，内容一般是几组 SettingsGroup。
 * Esc 与点遮罩都关闭；Esc 走 useEscapeLayer，一次只关最上面一层。
 */
import DialogTitlebar from '@/components/DialogTitlebar.vue'
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

/* 玻璃材质（底色、模糊、内高光、投影）来自 .yb-glass，这里只管形状与布局 */
.grab-sheet {
  position: fixed;
  top: var(--space-3);
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: calc(var(--z-sheet) + 1);
  display: flex;
  flex-direction: column;
  width: min(480px, calc(100vw - var(--space-6)));
  border-radius: var(--radius-2xl);
  color: var(--text-primary);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.grab-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: 0 var(--space-5) var(--space-5);
  overflow-y: auto;
}

.grab-sheet-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.grab-sheet-fade-enter-active,
.grab-sheet-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.grab-sheet-slide-enter-active,
.grab-sheet-slide-leave-active {
  transition: var(--transition-panel);
}

.grab-sheet-fade-enter-from,
.grab-sheet-fade-leave-to {
  opacity: 0;
}

.grab-sheet-slide-enter-from,
.grab-sheet-slide-leave-to {
  opacity: 0;
  transform: translateX(var(--space-8));
}
</style>
