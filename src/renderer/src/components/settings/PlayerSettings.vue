<template>
  <SettingsGroup
    title="播放引擎"
    :footer="
      preferredPlayerEngine === 'mpv'
        ? '使用 mpv 需要系统已安装 mpv 或配置环境变量 YINGBOX_MPV_PATH。若未检测到会自动回退至内置播放器。'
        : undefined
    "
  >
    <SettingsRow stacked>
      <SettingsRadioList
        v-model="preferredPlayerEngine"
        label="播放引擎"
        :options="playerEngineOptions"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    v-if="preferredPlayerEngine === 'mpv'"
    :footer="mpvState.running ? `当前播放：${mpvResolutionText}` : undefined"
  >
    <SettingsRow
      title="RTX 视频超分"
      description="仅 Windows + NVIDIA 显卡有效：片源低于 1080p 时自动调用 NVIDIA 视频超分（需在 NVIDIA app 中打开「视频超级分辨率」）"
    >
      <UiSwitch v-model="rtxVsrEnabled" label="RTX 视频超分" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 播放器：播放引擎（preferred_player_engine）与 mpv 下的 RTX 视频超分开关。
 */
import { computed, ref, watch } from 'vue'

import {
  getRtxVsrEnabled,
  setRtxVsrEnabled,
  syncRtxVsr,
} from '@/composables/use-media-player'
import { useMpvPlayer } from '@/composables/use-mpv-player'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import SettingsGroup from './SettingsGroup.vue'
import SettingsRadioList, {
  type SettingsRadioOption,
} from './SettingsRadioList.vue'
import SettingsRow from './SettingsRow.vue'

type PlayerEngine = 'built-in' | 'mpv'

const playerEngineOptions: SettingsRadioOption<PlayerEngine>[] = [
  {
    value: 'built-in',
    label: '内置网页播放器 (Artplayer)',
    desc: '轻量快速，支持 HLS 流与常规 mp4/webm 格式',
  },
  {
    value: 'mpv',
    label: 'mpv 高级播放器 (推荐)',
    desc: '全格式硬解，支持 ASS 特效字幕、多音轨与 HDR/4K 高码率',
  },
]

const preferredPlayerEngine = ref<PlayerEngine>(
  (localStorage.getItem('preferred_player_engine') as PlayerEngine) ||
    'built-in'
)
watch(preferredPlayerEngine, val => {
  localStorage.setItem('preferred_player_engine', val)
})

// ── RTX 视频超分（NVIDIA） ─────────────────────────────────
const { status: mpvState } = useMpvPlayer()
const rtxVsrEnabled = ref(getRtxVsrEnabled())
watch(rtxVsrEnabled, val => {
  setRtxVsrEnabled(val)
  syncRtxVsr()
})

/** 当前播放分辨率文案：片源 →（超分后） */
const mpvResolutionText = computed(() => {
  const {
    videoWidth: w,
    videoHeight: h,
    vsrWidth: vw,
    vsrHeight: vh,
    vsr,
  } = mpvState.value
  if (!w || !h) return '读取中…'
  const source = `${w}×${h}`
  if (vsr && vw && vh) {
    const scale = Math.round((vw / w) * 10) / 10
    return `${source} → ${vw}×${vh}（RTX 超分 ${scale}×）`
  }
  return `${source}（未超分：片源 ≥ 1080p 或设备不支持）`
})
</script>
