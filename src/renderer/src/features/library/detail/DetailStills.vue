<template>
  <!-- 剧照：横向滑动，点开灯箱 -->
  <section v-if="shown.length" class="lib-section">
    <UiShelf title="剧照" class="lib-stills" list>
      <div
        v-for="(path, i) in shown"
        :key="path"
        class="lib-still"
        role="listitem"
      >
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
            @error="failed.add(path)"
          />
        </UiPressable>
      </div>
    </UiShelf>
    <StillLightbox v-model:index="open" :stills="shown" />
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的剧照区块（接回原番号详情页的剧照）：UiShelf 横排 16:9 圆角大卡（效果图 D-2 预告片一排的版式，
 * 一屏约 3 张，超出时标题行出左右滚动键），点开灯箱看大图。
 * 剧照来源与回退规则见 detail-rules.ts 的 stillsOf；加载失败的剧照（含被主进程拦掉的图床占位图）
 * 从缩略图和灯箱里一起去掉，全部失败时整个区块不显示。
 */
import { computed, reactive, ref, watch } from 'vue'

import UiPressable from '@/components/ui/UiPressable.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import { stillImage } from '../api/images'
import StillLightbox from './StillLightbox.vue'

const props = defineProps<{ stills: string[] }>()

/** 灯箱当前张；null 为关闭。 */
const open = ref<number | null>(null)
/** 加载失败的剧照。 */
const failed = reactive(new Set<string>())
const shown = computed(() => props.stills.filter(path => !failed.has(path)))
watch(
  () => props.stills,
  () => {
    open.value = null
    failed.clear()
  }
)
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-stills :deep(.yb-shelf-track) {
  --shelf-cols: 3.2;
}
.lib-still-target {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
}
/* 0.5px 发丝边 */
.lib-still-target::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px var(--media-glass-border);
  content: '';
  pointer-events: none;
}
.lib-still-target img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-normal) var(--ease-out);
}
.lib-still-target:hover img {
  transform: scale(1.04);
}
.lib-still-target:focus-visible {
  box-shadow: var(--focus-ring-offset);
}
@container (max-width: 560px) {
  .lib-stills :deep(.yb-shelf-track) {
    --shelf-cols: 1.4;
  }
}
</style>
