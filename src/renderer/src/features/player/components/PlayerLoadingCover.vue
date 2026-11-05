<template>
  <div class="unified-player-loading" aria-hidden="true">
    <img
      v-if="poster"
      class="unified-player-loading-poster"
      :class="{ 'is-landscape': landscape }"
      :src="poster"
      alt=""
      draggable="false"
      @load="onLoad"
    />
    <div class="unified-player-loading-spin" />
  </div>
</template>

<script setup lang="ts">
/**
 * 播放器加载中的遮罩：海报（有则显示）+ 转圈。开播后由父组件移除，不留背景。
 * 横版图（背景图 / 剧照）铺满整个播放器；竖版海报居中显示。
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  /** 海报地址；空串表示没有海报 */
  poster: string
}>()

const landscape = ref(false)

watch(
  () => props.poster,
  () => (landscape.value = false)
)

const onLoad = (event: Event): void => {
  const img = event.target as HTMLImageElement
  landscape.value = img.naturalWidth > img.naturalHeight
}
</script>

<style scoped>
.unified-player-loading {
  position: absolute;
  inset: 0;
  z-index: var(--z-above);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--media-bg);
  pointer-events: none;
}

.unified-player-loading-poster {
  max-width: min(72%, 420px);
  max-height: min(78%, 72vh);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.unified-player-loading-poster.is-landscape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  object-fit: cover;
  border-radius: 0;
  box-shadow: none;
}

.unified-player-loading-spin {
  z-index: var(--z-raised);
  position: absolute;
  bottom: var(--space-6_5);
  width: 22px;
  height: 22px;
  border: 2px solid var(--media-track);
  border-top-color: var(--media-text-secondary);
  border-radius: 50%;
  animation: unified-player-spin var(--duration-spin) linear infinite;
}

@keyframes unified-player-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
