<template>
  <div class="recap-layer" :class="{ 'is-compact': compact }">
    <!-- 小窗里不挂提示卡：画面只有一点大，卡片会把它整个盖住 -->
    <RecapCard v-if="recap.visible.value && !compact" :state="recap" />
    <PlotQaPanel v-if="qa.open.value" :state="qa" :compact="compact" />
  </div>
  <!-- 读屏：流式正文不逐字播报，只在生成完成 / 失败 / 停止时说一句 -->
  <span class="ui-sr-only" role="status" aria-live="polite">
    {{ recap.announcement.value }}
  </span>
  <span class="ui-sr-only" role="status" aria-live="polite">
    {{ qa.announcement.value }}
  </span>
</template>

<script setup lang="ts">
/**
 * 播放器上的前情提要 / 问剧情层：提示卡、问剧情面板，以及设置菜单 / 右键菜单里的入口。
 * 只对本地视频生效；UnifiedVideoPlayer 只需放一个 <RecapLayer>，状态都在 useRecap / usePlotQa。
 *
 * 层级：本层铺满播放区、自身不接收点击，z-index 为 --z-popover；Artplayer 的层级被 UnifiedVideoPlayer
 * 关在视频区的独立层叠上下文里，所以卡片和面板始终盖在播放器遮罩、控制栏之上，点击不会落到视频上。
 * 尺寸按本层容器（cqw / cqh）算，不按应用窗口；缩进小窗（compact）时不挂提示卡，问剧情面板铺满小窗。
 */
import type Artplayer from 'artplayer'
import { watch } from 'vue'

import { installRecapEntry } from './art-entries'
import PlotQaPanel from './PlotQaPanel.vue'
import RecapCard from './RecapCard.vue'
import { usePlotQa } from './use-plot-qa'
import { useRecap } from './use-recap'

const props = withDefaults(
  defineProps<{
    /** 当前实例的播放地址（解析后）；local:// 才生效 */
    source?: string
    /** 来自私密板块：模型按设置只用本地，不联网查分集简介 */
    private?: boolean
    /** 起播位置（秒）：从头播才提示前情提要 */
    startAt?: number
    /** 当前 Artplayer 实例 */
    player: () => Artplayer | null
    /** 缩在角落小窗里 */
    compact?: boolean
  }>(),
  { source: '', private: false, startAt: 0, compact: false }
)

const recap = useRecap({
  source: () => props.source,
  isPrivate: () => props.private,
  startAt: () => props.startAt,
})

const qa = usePlotQa({
  source: () => props.source,
  isPrivate: () => props.private,
  currentTime: () => props.player()?.currentTime ?? 0,
})

/** 打开问剧情时收起前情提要卡，两者不叠在一起 */
const openQa = (): void => {
  recap.close()
  qa.openPanel()
}

// 本地视频：设置菜单 / 右键加「问剧情」；之前几集有素材时再加「前情提要」
watch(
  () => props.source,
  source => {
    const art = props.player()
    if (art && qa.supported() && source)
      installRecapEntry(art, {
        name: 'ybPlotQa',
        label: '问剧情',
        open: openQa,
      })
  },
  { immediate: true }
)

// 在小窗里时，还没点开的提示卡直接收起（含小窗期间才到点浮出的，展开回来不再冒出来）；
// 点开过的保留，展开后接着看
watch(
  () => [props.compact, recap.visible.value] as const,
  ([compact, visible]) => {
    if (compact && visible && !recap.expanded.value) recap.close()
  }
)

watch(recap.available, available => {
  const art = props.player()
  if (art && available)
    installRecapEntry(art, {
      name: 'ybRecap',
      label: '前情提要',
      open: recap.show,
    })
})
</script>

<style scoped>
.recap-layer {
  position: absolute;
  inset: 0;
  z-index: var(--z-popover);
  container-type: size;
  pointer-events: none;
}

.recap-layer > * {
  pointer-events: auto;
}
</style>
