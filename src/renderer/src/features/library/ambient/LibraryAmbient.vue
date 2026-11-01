<template>
  <div class="lib-ambient" :data-section="section" aria-hidden="true">
    <Transition name="lib-ambient-fade">
      <img
        v-if="src"
        :key="src"
        class="lib-ambient-img"
        :src="src"
        alt=""
        decoding="async"
        draggable="false"
      />
    </Transition>
    <div class="lib-ambient-glow" />
    <div class="lib-ambient-grain" />
  </div>
</template>

<script setup lang="ts">
/**
 * 片库页顶部的环境光层（各片库分区共用）。
 *
 * 用的是海报墙已经加载过的 300 宽缩略图，放大重模糊，静态一层，不随滚动重绘；
 * 换海报时淡入淡出。降低透明度（系统偏好或设置）时去掉模糊图，只留分区色光晕。
 * 分区色由页面根节点的 --ambient-glow / --ambient-accent 提供（见 ambient-rules.ts 的 ambientVars）。
 */
import { computed } from 'vue'
import { itemImage } from '../api/images'
import type { LibrarySection } from '../state/library-section'

const props = defineProps<{
  section: LibrarySection
  /** 条目原始海报地址（未转换），null 时只显示光晕。 */
  poster: string | null
}>()

const src = computed(() => itemImage(props.poster, 300))
</script>

<style src="./ambient.css"></style>
