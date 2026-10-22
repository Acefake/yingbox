<template>
  <Teleport to="body">
    <Transition name="lib-lightbox">
      <div
        v-if="index !== null && stills[index]"
        class="lib-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="剧照"
        @click.self="close"
      >
        <img
          :key="stills[index]"
          class="lib-lightbox-img"
          :src="stillImage(stills[index], 'full')"
          alt=""
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <span class="lib-lightbox-count"
          >{{ index + 1 }} / {{ stills.length }}</span
        >
        <template v-if="stills.length > 1">
          <UiIconButton
            class="lib-lightbox-prev"
            icon="back"
            label="上一张"
            variant="overlay"
            size="lg"
            @click="step(-1)"
          />
          <UiIconButton
            class="lib-lightbox-next"
            icon="forward"
            label="下一张"
            variant="overlay"
            size="lg"
            @click="step(1)"
          />
        </template>
        <UiIconButton
          class="lib-lightbox-close"
          icon="close"
          label="关闭"
          variant="overlay"
          size="lg"
          @click="close"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/** 剧照灯箱：大图、左右循环切换（← / → 键同样）、Esc 或点遮罩关闭。index 为 null 时不显示。 */
import { useEventListener } from '@vueuse/core'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import { isDismissKey } from '@/utils/keyboard'

import { stillImage } from '../api/images'

const props = defineProps<{ stills: string[] }>()
const index = defineModel<number | null>('index', { required: true })

const close = (): void => {
  index.value = null
}
const step = (delta: number): void => {
  if (index.value === null) return
  const n = props.stills.length
  index.value = (index.value + delta + n) % n
}

useEventListener(
  window,
  'keydown',
  (event: KeyboardEvent) => {
    if (index.value === null) return
    if (isDismissKey(event)) close()
    else if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else return
    // 不让详情页的 Esc（返回海报墙）同时触发
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  { capture: true }
)
</script>

<style scoped>
.lib-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--z-lightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-scrim-strong);
}
.lib-lightbox-img {
  max-width: 90vw;
  max-height: 86vh;
  border-radius: var(--radius-md);
  object-fit: contain;
}
.lib-lightbox-count {
  position: absolute;
  bottom: var(--space-5);
  left: 50%;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  transform: translateX(-50%);
}
.lib-lightbox-prev,
.lib-lightbox-next {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}
.lib-lightbox-prev {
  left: var(--space-4);
}
.lib-lightbox-next {
  right: var(--space-4);
}
.lib-lightbox-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
}
.lib-lightbox-enter-active,
.lib-lightbox-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.lib-lightbox-enter-from,
.lib-lightbox-leave-to {
  opacity: 0;
}
</style>
