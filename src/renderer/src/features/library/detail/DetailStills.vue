<template>
  <!-- 剧照：横向滑动，点开灯箱 -->
  <section class="lib-section">
    <h2 class="lib-section-title">剧照</h2>
    <ul class="lib-stills custom-scrollbar">
      <li v-for="(path, i) in stills" :key="path" class="lib-still">
        <UiPressable
          block
          class="lib-still-target"
          :label="`查看第 ${i + 1} 张剧照`"
          @click="open = i"
        >
          <img
            :src="stillImage(path, 'thumb')"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="hide"
          />
        </UiPressable>
      </li>
    </ul>
    <StillLightbox v-model:index="open" :stills="stills" />
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的剧照区块（接回原番号详情页的剧照）：横排缩略图，点开灯箱看大图。
 * 剧照来源与回退规则见 detail-rules.ts 的 stillsOf；加载失败的缩略图隐藏，不留破图。
 */
import { ref, watch } from 'vue'

import UiPressable from '@/components/ui/UiPressable.vue'

import { stillImage } from '../api/images'
import StillLightbox from './StillLightbox.vue'

const props = defineProps<{ stills: string[] }>()

/** 灯箱当前张；null 为关闭。 */
const open = ref<number | null>(null)
watch(
  () => props.stills,
  () => (open.value = null)
)

function hide(event: Event): void {
  const li = (event.target as HTMLElement).closest('li')
  if (li) li.hidden = true
}
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-stills {
  display: flex;
  gap: var(--space-3);
  margin: 0 calc(var(--content-padding-x) * -1);
  padding: 0 var(--content-padding-x) var(--space-3);
  overflow-x: auto;
  list-style: none;
  scroll-padding-inline: var(--content-padding-x);
  scroll-snap-type: x proximity;
}
.lib-still {
  flex: 0 0 auto;
  scroll-snap-align: start;
}
.lib-still-target {
  height: 150px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}
.lib-still-target img {
  display: block;
  width: auto;
  min-width: 100px;
  height: 100%;
  transition: transform var(--duration-normal) var(--ease-out);
}
.lib-still-target:hover img {
  transform: scale(1.04);
}
.lib-still-target:focus-visible {
  box-shadow: var(--focus-ring-offset);
}
</style>
