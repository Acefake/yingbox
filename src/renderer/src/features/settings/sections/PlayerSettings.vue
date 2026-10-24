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
    <SettingsRow
      v-if="mpvState.running"
      title="缩小置顶"
      description="把 mpv 窗口缩到屏幕右下角并保持在最前；在 mpv 窗口里按 Alt+P 也能切换"
    >
      <UiSwitch
        :model-value="Boolean(mpvState.compact)"
        label="缩小置顶"
        @update:model-value="setMpvCompact"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="片头片尾"
    footer="在内置播放器里右键标记片头开始 / 结束、片尾开始，同一部剧每集通用；也可在媒体库剧集详情里「检测片头片尾」。"
  >
    <SettingsRow
      title="自动跳过片头"
      description="进入已标记的片头时直接跳到片头结束；关闭时只显示「跳过片头」按钮"
    >
      <UiSwitch v-model="autoSkipIntro" label="自动跳过片头" />
    </SettingsRow>
    <SettingsRow
      title="播放剧集时自动检测本季"
      description="播放本地剧集时在后台比对各集音频，找出共同的片头片尾；手动标记的不会被覆盖。需要 ffmpeg"
    >
      <UiSwitch v-model="autoDetectIntro" label="播放剧集时自动检测本季" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="小窗">
    <SettingsRow
      title="播放弹窗可缩成小窗"
      description="点缩小或切到别的页面时，画面移到角落小窗接着播，不重新加载"
    >
      <UiSwitch v-model="miniPlayer" label="应用内小窗" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 播放器：播放引擎（player.engine）、mpv 下的 RTX 视频超分（player.rtxVsr）与缩小置顶，
 * 内置播放器自动跳过片头（player.autoSkipIntro）与播放时自动检测片头片尾（player.autoDetectIntro），播放弹窗的角落小窗（ui.miniPlayer）。
 */
import { computed, watch } from 'vue'

import { syncRtxVsr, useMpvPlayer } from '@/features/player'
import UiSwitch from '@/components/ui/UiSwitch.vue'

import type { SettingValue } from '../../../../../shared/settings/schema'
import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRadioList, {
  type SettingsRadioOption,
} from '../ui/SettingsRadioList.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

type PlayerEngine = SettingValue<'player.engine'>

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

const preferredPlayerEngine = useSetting('player.engine')

// ── RTX 视频超分（NVIDIA） ─────────────────────────────────
const { status: mpvState, setCompact } = useMpvPlayer()
const setMpvCompact = (on: boolean): void => {
  void setCompact(on).catch(() => {})
}

const miniPlayer = useSetting('ui.miniPlayer')
const autoSkipIntro = useSetting('player.autoSkipIntro')
const autoDetectIntro = useSetting('player.autoDetectIntro')
const rtxVsrEnabled = useSetting('player.rtxVsr')
watch(rtxVsrEnabled, () => syncRtxVsr())

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
