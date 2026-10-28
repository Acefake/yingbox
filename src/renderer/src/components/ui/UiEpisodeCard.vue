<template>
  <article class="yb-episode" @contextmenu.prevent="emit('menu', $event)">
    <UiPressable
      block
      class="yb-episode-hit"
      :label="label || title"
      @click="emit('open')"
    >
      <slot v-if="$slots.art" name="art" />
      <img
        v-else-if="image && !broken"
        :src="image"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="broken = true"
      />
      <UiCoverFallback v-else hide-title :title="title" />
      <span class="yb-pblur" aria-hidden="true"><i /><i /><i /><i /></span>
    </UiPressable>
    <div v-if="$slots.badge" class="yb-episode-badge">
      <slot name="badge" />
    </div>
    <div class="yb-episode-copy">
      <h3 class="yb-episode-title" :title="title">{{ title }}</h3>
      <p v-if="subtitle" class="yb-episode-sub">{{ subtitle }}</p>
      <span
        v-if="progress !== undefined && progress !== null"
        class="yb-episode-progress"
        aria-hidden="true"
        ><i :style="{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }"
      /></span>
      <div v-if="foot || menuLabel" class="yb-episode-foot">
        <span v-if="foot" class="yb-episode-foot-text"
          ><UiIcon v-if="footIcon" :name="footIcon" size="sm" filled />{{
            foot
          }}</span
        >
        <UiIconButton
          v-if="menuLabel"
          class="yb-episode-menu"
          icon="more"
          size="sm"
          :label="menuLabel"
          @click.stop="emit('menu', $event)"
        />
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 横版剧照卡（Apple TV 的「继续观看」/ 剧集卡）：16:9 剧照铺满，下半同一张图渐进模糊 + 暗化，
 * 上面压标题、副标题、可选进度条，底行是「▶ 剩余 18 分钟」这类说明和 … 菜单键。
 *
 * 点卡 emit open；右键或点 … emit menu（带鼠标事件，菜单由使用方弹）。宽度由外层（UiShelf）定。
 * 插槽：art 换掉剧照（如直播卡的台标画面），badge 放在右上角的小标签（规格角标、「直播」胶囊）。
 */
import { ref, watch } from 'vue'

import type { IconName } from './icons'
import UiCoverFallback from './UiCoverFallback.vue'
import UiIcon from './UiIcon.vue'
import UiIconButton from './UiIconButton.vue'
import UiPressable from './UiPressable.vue'

const props = defineProps<{
  title: string
  subtitle?: string
  /** 横版剧照 / 背景图 */
  image?: string
  /** 0–1；不给不显示进度条 */
  progress?: number | null
  /** 底行说明，如「剩余 18 分钟」 */
  foot?: string
  footIcon?: IconName
  /** 点卡的无障碍名称；默认片名 */
  label?: string
  /** … 菜单键的无障碍名称；不给不显示菜单键 */
  menuLabel?: string
}>()
const emit = defineEmits<{ open: []; menu: [event: MouseEvent] }>()

const broken = ref(false)
watch(
  () => props.image,
  () => (broken.value = false)
)
</script>

<style>
.yb-episode {
  --pblur-height: 62%;
  position: relative;
  min-width: 0;
  aspect-ratio: 270 / 172; /* style-tokens: layout（Apple TV 继续观看卡比例） */
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
  color: var(--media-text);
  isolation: isolate;
  transition:
    transform var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}
/* 0.5px 发丝边 */
.yb-episode::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px var(--glass-media-edge);
  content: '';
  pointer-events: none;
}
.yb-episode:hover,
.yb-episode:focus-within {
  transform: scale(1.03);
  box-shadow: var(--shadow-lg);
}
.yb-episode-hit {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.yb-episode-hit:active:not(:disabled) {
  transform: none;
}
.yb-episode-hit img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.yb-episode-badge {
  position: absolute;
  top: var(--space-2_5);
  right: var(--space-2_5);
  left: var(--space-2_5);
  z-index: var(--z-above);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1_5);
  pointer-events: none;
}
.yb-episode-copy {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 0 var(--space-4) var(--space-2_5);
  pointer-events: none;
}
.yb-episode-title {
  margin: 0;
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yb-episode-sub {
  margin: 0;
  overflow: hidden;
  color: var(--media-text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yb-episode-progress {
  display: block;
  height: 4px;
  margin-top: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--media-track);
}
.yb-episode-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--media-text);
}
.yb-episode-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--control-height-sm);
  margin-top: var(--space-1);
  color: var(--media-text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.yb-episode-foot-text {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.yb-icon-button.yb-episode-menu {
  margin-right: calc(var(--space-1) * -1);
  color: var(--media-text-secondary);
  pointer-events: auto;
}
.yb-icon-button.yb-episode-menu:hover {
  background: var(--media-hover);
  color: var(--media-text);
}
@media (prefers-reduced-motion: reduce) {
  .yb-episode:hover,
  .yb-episode:focus-within {
    transform: none;
  }
}
</style>
