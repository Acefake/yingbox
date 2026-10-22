<template>
  <!-- 图片灯箱 -->
  <Transition name="lb-fade">
    <div v-if="index !== null" class="lb-mask" @click.self="close()">
      <UiIconButton
        class="lb-arrow lb-prev"
        icon="back"
        label="上一张"
        variant="overlay"
        size="lg"
        @click="step(-1)"
      />
      <img :src="images[index!].full" class="lb-img" />
      <UiIconButton
        class="lb-arrow lb-next"
        icon="forward"
        label="下一张"
        variant="overlay"
        size="lg"
        @click="step(1)"
      />
      <UiIconButton
        class="lb-close"
        icon="close"
        label="关闭"
        variant="overlay"
        size="lg"
        @click="close()"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 剧照灯箱：原图、左右循环切换、点遮罩或关闭按钮退出。index 为 null 时不显示。
 */
import UiIconButton from '@/components/ui/UiIconButton.vue'

import type { DetailImage } from '../types'

const props = defineProps<{ images: DetailImage[]; index: number | null }>()
const emit = defineEmits<{ (e: 'update:index', index: number | null): void }>()

const close = (): void => emit('update:index', null)
const step = (delta: number): void =>
  emit(
    'update:index',
    (props.index! + delta + props.images.length) % props.images.length
  )
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* 灯箱 */
.lb-fade-enter-active,
.lb-fade-leave-active {
  transition: opacity var(--duration-normal);
}

.lb-fade-enter-from,
.lb-fade-leave-to {
  opacity: 0;
}

.lb-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-lightbox);
  background: var(--overlay-scrim-strong);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lb-img {
  max-width: 90vw;
  max-height: 86vh;
  border-radius: var(--radius-md);
  object-fit: contain;
}

.lb-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.lb-prev {
  left: var(--space-4);
}

.lb-next {
  right: var(--space-4);
}

.lb-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
}
</style>
