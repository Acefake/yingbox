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
      <!-- 页面自带返回圆钮时：在拖拽条上给它挖一个不可拖的洞（只挡拖拽，不挡点击） -->
      <div v-if="pageOwnsBack" class="toolbar-hole" aria-hidden="true" />
      <div
        v-if="!pageOwnsBack && (canGoBack || canGoForward)"
        class="toolbar-pill yb-glass"
        role="group"
        aria-label="页面导航"
      >
        <UiIconButton
          class="toolbar-pill-button"
          icon="back"
          label="后退"
          :disabled="!canGoBack"
          @click="navigateBack"
        />
        <UiIconButton
          v-if="!isPhone"
          :disabled="!canGoForward"
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
 * 顶部浮动控件：左侧前进 / 后退玻璃胶囊（跟在侧栏右边，有历史可走时才出现，效果图 E-1 首屏没有它；
 * 自带返回圆钮的页面显示时让位，见 use-shell-chrome），
 * 右侧窗口键玻璃胶囊（132×44，自绘最小化 / 最大化 / 关闭，只在 Electron 里）。
 * 整条透明、保留窗口拖拽区域，按钮本身不可拖。拖拽条从侧栏右边开始，不压在侧栏上；
 * Electron 把拖拽区当成标题栏，落在拖拽区里的点击到不了页面，所以页面自带的返回圆钮
 * （条目详情）由 .toolbar-hole 让出一块不可拖区域。全局搜索在侧栏里（SidebarSearch）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import WinControls from '@/components/WinControls.vue'
import { usePlatform } from '@/composables/use-platform'
import { pageOwnsBack } from '@/composables/use-shell-chrome'

const emit = defineEmits<{ 'open-menu': [] }>()

const router = useRouter()
const { isElectron, isPhone } = usePlatform()

/** vue-router 把相邻历史记录写在 history.state.back / forward 里，每次导航后重读 */
const canGoBack = ref(false)
const canGoForward = ref(false)
const readHistory = (): void => {
  const state = window.history.state as {
    back?: unknown
    forward?: unknown
  } | null
  canGoBack.value = Boolean(state?.back)
  canGoForward.value = Boolean(state?.forward)
}
readHistory()
router.afterEach(() => queueMicrotask(readHistory))

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
  left: var(--shell-left);
  z-index: calc(var(--z-float) + 1); /* 盖在铺满窗口的页面层（条目详情）之上 */
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  height: calc(
    var(--shell-pill-top) + var(--shell-pill-height) + var(--space-2)
  );
  padding: var(--shell-pill-top) var(--shell-pill-right) 0 var(--space-5);
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
/* 页面返回圆钮所在的一块（条目详情 --detail-x 处）：不可拖、也不接点击，点击落到下面的页面 */
.toolbar-hole {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(var(--space-6_5) + var(--shell-pill-height) + var(--space-5));
  height: 100%;
  pointer-events: none;
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
