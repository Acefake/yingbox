<template>
  <span class="grab-poster" :class="`is-${size}`" aria-hidden="true">
    <img
      v-if="src && !failed"
      class="grab-poster-img"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <UiCoverFallback v-else :title="title" hide-title />
  </span>
</template>

<script setup lang="ts">
/**
 * 追更列表里的小海报（2:3）：剧集、电影一行前面那张。src 是已换好的界面地址
 * （剧集走片库图片规则，电影走缩略图服务）；没有图或加载失败时是按片名算的渐变色块。
 * 装饰性的，读屏跳过（行里已有片名）。
 */
import { ref, watch } from 'vue'

import UiCoverFallback from '@/components/ui/UiCoverFallback.vue'

const props = withDefaults(
  defineProps<{
    src: string | null
    title: string
    /** sm：列表行；md：分组头；lg：待处理卡片 */
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'sm' }
)

const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false)
)
</script>

<style scoped>
.grab-poster {
  position: relative;
  display: block;
  flex: none;
  width: 36px;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
}

.grab-poster.is-md {
  width: 48px;
}

.grab-poster.is-lg {
  width: 56px;
}

.grab-poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
