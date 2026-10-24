<template>
  <SettingsRow
    title="Anime4K 超分"
    description="用 Anime4K 着色器实时修复并放大动画画面，较吃显卡；首次使用时自动下载着色器（不到 1 MB）"
  >
    <UiSwitch v-model="enabled" label="Anime4K 超分" />
  </SettingsRow>
  <template v-if="enabled">
    <SettingsRow title="模式" :description="modeHint">
      <UiSegmented
        v-model="mode"
        size="sm"
        label="Anime4K 模式"
        :options="modeOptions"
      />
    </SettingsRow>
    <SettingsRow
      title="档位"
      description="画质档更清晰但更吃显卡；出现掉帧时换成性能档"
    >
      <UiSegmented
        v-model="quality"
        size="sm"
        label="Anime4K 档位"
        :options="qualityOptions"
      />
    </SettingsRow>
    <SettingsRow
      title="仅动画类条目"
      description="只在媒体库类型或在线分类为动画 / 动漫时启用，其它影片按原画播放"
    >
      <UiSwitch v-model="animeOnly" label="仅动画类条目启用 Anime4K" />
    </SettingsRow>
  </template>
</template>

<script setup lang="ts">
/**
 * 设置 · 播放器 · mpv 下的 Anime4K 超分：开关、模式（A / B / C）、档位（画质 / 性能）、仅动画类条目。
 * 放在 PlayerSettings 的 mpv 分组里；任一项变化都同步给主进程（mpv 在播时立即生效）。
 */
import { computed, watch } from 'vue'

import { syncAnime4k } from '@/features/player'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import type { SettingValue } from '../../../../../shared/settings/schema'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

const enabled = useSetting('player.anime4k')
const mode = useSetting('player.anime4kMode')
const quality = useSetting('player.anime4kQuality')
const animeOnly = useSetting('player.anime4kAnimeOnly')

const modeOptions: SegmentedOption<SettingValue<'player.anime4kMode'>>[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
]

const qualityOptions: SegmentedOption<SettingValue<'player.anime4kQuality'>>[] =
  [
    { value: 'hq', label: '画质' },
    { value: 'fast', label: '性能' },
  ]

/** 各模式适合的片源（官方说明） */
const MODE_HINTS: Record<SettingValue<'player.anime4kMode'>, string> = {
  a: '适合大多数 1080p 动画和偏糊的老片：修复线条、去模糊',
  b: '适合多数 720p 和由 1080p 缩小的片源：减少振铃与锯齿',
  c: '适合几乎无损的高质量片源：只降噪放大，保留原画',
}
const modeHint = computed(() => MODE_HINTS[mode.value])

watch([enabled, mode, quality, animeOnly], () => syncAnime4k())
</script>
