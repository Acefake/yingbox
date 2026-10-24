<template>
  <RecapCard v-if="recap.visible.value" :state="recap" />
  <PlotQaPanel v-if="qa.open.value" :state="qa" />
</template>

<script setup lang="ts">
/**
 * 播放器上的前情提要 / 问剧情层：提示卡、问剧情面板，以及设置菜单 / 右键菜单里的入口。
 * 只对本地视频生效；UnifiedVideoPlayer 只需放一个 <RecapLayer>，状态都在 useRecap / usePlotQa。
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
  }>(),
  { source: '', private: false, startAt: 0 }
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
