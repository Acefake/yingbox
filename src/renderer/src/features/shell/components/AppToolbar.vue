<template>
  <header class="top-menu" :class="{ 'is-phone': isPhone }">
    <div class="toolbar-leading">
      <UiIconButton
        v-if="isPhone"
        class="toolbar-menu"
        icon="menu"
        label="打开菜单"
        @click="emit('open-menu')"
      />
      <div class="toolbar-pill yb-glass" role="group" aria-label="页面导航">
        <UiIconButton
          class="toolbar-pill-button"
          icon="back"
          label="后退"
          @click="navigateBack"
        />
        <UiIconButton
          v-if="!isPhone"
          class="toolbar-pill-button"
          icon="forward"
          label="前进"
          @click="router.forward()"
        />
      </div>
    </div>

    <WinControls
      v-if="isElectron"
      class="toolbar-pill toolbar-window yb-glass"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 顶部浮动控件：左侧前进 / 后退玻璃胶囊（跟在侧栏右边），右侧窗口键玻璃胶囊（自绘最小化 / 最大化 / 关闭，
 * 只在 Electron 里）。整条透明、保留窗口拖拽区域，按钮本身不可拖。全局搜索在侧栏里（SidebarSearch）。
 */
import { useRouter } from 'vue-router'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import WinControls from '@/components/WinControls.vue'
import { usePlatform } from '@/composables/use-platform'

const emit = defineEmits<{ 'open-menu': [] }>()

const router = useRouter()
const { isElectron, isPhone } = usePlatform()

/** 后退前先广播 app:navigate-back，页面可 preventDefault 自己处理（如关闭详情层） */
const navigateBack = (): void => {
  const event = new CustomEvent('app:navigate-back', { cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) router.back()
}
</script>

<style scoped>
/* 透明的拖拽条：盖在内容顶部，只有胶囊接收点击 */
.top-menu {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: var(--z-above);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  height: var(--titlebar-height);
  padding: var(--shell-inset) var(--space-5) 0
    calc(var(--shell-left) + var(--space-5));
  pointer-events: none;
  -webkit-app-region: drag;
}
.toolbar-leading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.toolbar-pill {
  display: flex;
  align-items: center;
  gap: var(--space-0_5);
  height: var(--shell-pill-height);
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
  color: var(--text-primary);
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
.toolbar-menu {
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
.toolbar-pill-button,
.toolbar-window :deep(.yb-icon-button) {
  --ib-size: 36px;
  border-radius: var(--radius-full);
  color: var(--text-primary);
}

.top-menu.is-phone {
  height: calc(var(--titlebar-height) + var(--safe-top));
  padding: calc(var(--safe-top) + var(--space-1)) var(--space-2) 0;
}
</style>
