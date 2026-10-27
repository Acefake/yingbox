<template>
  <span class="live-logo" aria-hidden="true">
    <img
      v-if="logo && !broken"
      :src="logo"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
    <span v-else class="live-logo-mark">{{ logoText(name) }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 频道台标方块：有台标显示图片（contain），没有或加载失败时显示台名缩写。
 * 尺寸由使用方的 class 定（默认 48×48）。
 */
import { ref, watch } from 'vue'

import { logoText } from '../utils/live-rules'

const props = defineProps<{
  name: string
  logo?: string
}>()

const broken = ref(false)

// 虚拟网格复用节点时换了台标：重新尝试加载
watch(
  () => props.logo,
  () => {
    broken.value = false
  }
)
</script>

<style scoped>
.live-logo {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--control-bg);
  box-shadow: inset 0 0 0 0.5px var(--border-glass-light);
}

.live-logo img {
  width: 100%;
  height: 100%;
  padding: var(--space-1_5);
  object-fit: contain;
}

.live-logo-mark {
  max-width: 100%;
  padding: 0 var(--space-1);
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;
  text-align: center;
  /* 「CCTV-9」这类放不下一行的台名缩写折成两行 */
  overflow-wrap: anywhere;
}
</style>
