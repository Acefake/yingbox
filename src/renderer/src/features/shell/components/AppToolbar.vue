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
    </div>

    <WinControls
      v-if="isElectron"
      class="toolbar-pill toolbar-window yb-glass"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 顶部浮动控件：手机菜单、窗口控制与透明拖拽区域。搜索入口位于侧栏。
 */

import UiIconButton from '@/components/ui/UiIconButton.vue'
import WinControls from '@/components/WinControls.vue'
import { usePlatform } from '@/composables/use-platform'

const emit = defineEmits<{ 'open-menu': [] }>()

const { isElectron, isPhone } = usePlatform()
</script>

<style scoped>
/* 透明的拖拽条：盖在内容顶部，只有胶囊接收点击 */
.top-menu {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: calc(var(--z-float) + 1); /* 盖在铺满窗口的页面层（条目详情）之上 */
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  height: calc(
    var(--shell-pill-top) + var(--shell-pill-height) + var(--space-2)
  );
  padding: var(--shell-pill-top) var(--shell-pill-right) 0
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
.toolbar-window {
  justify-content: center;
  width: var(--shell-win-width);
}
.toolbar-window :deep(.win-controls) {
  gap: var(--space-1_5);
}
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
