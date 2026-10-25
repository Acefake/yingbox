<template>
  <!-- 一条结果：最像的那张图；是视频画面时角上标时间点，点图从那里播放 -->
  <li class="hit">
    <UiPressable
      block
      class="hit-media"
      :label="
        hit.frame
          ? `从 ${clock(hit.frame.at)} 播放 ${hit.title}`
          : `打开 ${hit.title}`
      "
      @click="
        hit.frame
          ? emit('play', hit.frame.fileId, hit.frame.at)
          : emit('open', hit.itemId)
      "
    >
      <img :src="src" alt="" loading="lazy" decoding="async" />
      <span v-if="hit.frame" class="hit-time">
        <UiIcon name="play" size="sm" />{{ clock(hit.frame.at) }}
      </span>
    </UiPressable>
    <UiPressable
      class="hit-title"
      :label="`打开 ${hit.title}`"
      @click="emit('open', hit.itemId)"
    >
      {{ hit.title }}
    </UiPressable>
    <div v-if="moments.length" class="hit-moments">
      <UiChip
        v-for="m in moments"
        :key="`${m.fileId}-${m.at}`"
        :label="clock(m.at)"
        @click="emit('play', m.fileId, m.at)"
      />
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * 按画面搜的一张结果卡：封面 / 剧照点开进详情；视频画面点图从那个时间点播放，
 * 下面的时间点是这部片里另外几个相像的画面（最像的那个已经是图本身时不重复列出）。
 */
import { computed } from 'vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import type { VisualHit } from '../../../../../shared/library/ipc'
import { heroImage, stillImage } from '../api/images'
import { clock } from './visual-rules'

const props = defineProps<{ hit: VisualHit }>()
const emit = defineEmits<{
  open: [itemId: number]
  play: [fileId: number, at: number]
}>()

/** 帧缩略图本来就小，取原图；封面 / 剧照取缩略图。 */
const src = computed(() =>
  props.hit.frame
    ? (heroImage(props.hit.image) ?? '')
    : stillImage(props.hit.image, 'thumb')
)
const moments = computed(() =>
  (props.hit.moments ?? []).filter(m => m.image !== props.hit.image)
)
</script>

<style scoped>
.hit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.hit-media {
  position: relative;
}
.hit-media img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  transition: var(--transition-fast);
}
.hit-media:hover img {
  filter: brightness(1.06);
}
.hit-time {
  position: absolute;
  right: var(--space-2);
  bottom: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--overlay-scrim-strong);
  color: var(--media-text);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.hit-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-xs);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hit-moments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
