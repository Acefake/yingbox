<template>
  <Teleport to="body">
    <Transition name="player-modal">
      <div
        v-if="state"
        ref="modalRef"
        class="player-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        @keydown="trapTab"
      >
        <PlayerStage
          :session="state"
          @close="closePlayer"
          @title="title = $event"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 网页端的播放层：盖在当前页面上播放（页面状态不变），应用根组件挂载一次。桌面端在独立的播放器窗口里播
 * （host/player-host），这里始终不出现。
 *
 * - 关闭：Esc（输入法组字中的不算，走全局 Esc 层栈）或关闭圆钮；点不到遮罩，不会误触丢掉播放。
 *   播放会话卸载时保存进度、拆除 Artplayer / hls.js。
 * - 模态：Tab 只在播放层里循环，关闭后焦点还给打开前的元素。Artplayer 控制条与齿轮菜单都在播放台里；
 *   挂到 body 上的只有不可聚焦的 tooltip、popover 提示与 <dialog> 确认框，助手带 data-focus-scope，陷阱都放行。
 * - 画中画用播放器控制条自带的按钮（浏览器支持时显示）。
 */
import { ref } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'

import { closePlayer, inPagePlayer } from '../host/player-host'
import PlayerStage from '../stage/PlayerStage.vue'

const state = inPagePlayer()
const title = ref('')

// 全屏时 Esc 由浏览器先退出全屏，不会走到这里
useEscapeLayer(() => state.value !== null, closePlayer)
const modalRef = ref<HTMLElement | null>(null)
const trapTab = useModalFocus(modalRef, () => state.value !== null)
</script>

<style scoped>
.player-modal {
  outline: none;
  position: fixed;
  inset: 0;
  z-index: var(--z-player);
  background: var(--media-bg);
}

.player-modal-enter-active,
.player-modal-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.player-modal-enter-from,
.player-modal-leave-to {
  opacity: 0;
}
</style>
