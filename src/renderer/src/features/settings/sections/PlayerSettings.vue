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
    <Anime4kRows />
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
    <SettingsRow
      v-if="mpvInfoText"
      title="播放信息"
      :description="`${mpvInfoText}。在 mpv 窗口里按 I 可查看码率、丢帧、硬解等完整统计`"
    />
  </SettingsGroup>

  <SettingsGroup
    v-if="isElectron"
    title="HDR 与杜比视界"
    footer="进入内置播放器的 Profile 5 片源由 ffmpeg 的 libplacebo 重建色彩（需要 Vulkan）：HDR 显示器输出 HDR10，其他显示器色调映射到 SDR。重建做不了时，开着上面的开关就改用 mpv，否则直接播放并提示颜色可能不正确。"
  >
    <SettingsRow
      title="杜比视界 P5 自动用 mpv"
      description="内置播放器放杜比视界 Profile 5 会偏绿偏紫；装了 mpv 时这类视频自动用 mpv 播放。需要 ffmpeg（媒体库扫描时识别）"
    >
      <UiSwitch v-model="dvAutoMpv" label="杜比视界 P5 自动用 mpv" />
    </SettingsRow>
    <SettingsRow
      title="应用动态元数据"
      description="应用内重建时按杜比视界 RPU 逐场景映射色彩；关闭后只按片源的静态色彩信息转换"
    >
      <UiSwitch v-model="applyDolbyVision" label="应用杜比视界动态元数据" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="在线播放">
    <SettingsRow
      title="卡顿自动换源"
      description="内置播放器缓冲太久或出错时，换到下一个可用源的同一集，从当前进度继续"
    >
      <UiSwitch v-model="autoSwitchSource" label="卡顿自动换源" />
    </SettingsRow>
    <SettingsRow
      v-if="autoSwitchSource"
      title="卡顿判定"
      description="连续缓冲超过这个时长就换源"
    >
      <UiSelect
        v-model="stallSeconds"
        size="sm"
        aria-label="卡顿判定秒数"
        :options="stallOptions"
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

  <SettingsGroup v-if="isElectron" title="系统集成">
    <SettingsRow
      title="显示托盘图标"
      description="托盘菜单显示正在播放的内容，可播放 / 暂停、下一集、显示主窗口、退出"
    >
      <UiSwitch v-model="trayIcon" label="显示托盘图标" />
    </SettingsRow>
    <SettingsRow title="媒体键控制播放" :description="mediaKeysHint">
      <UiSwitch v-model="mediaKeys" label="媒体键控制播放" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 播放器：播放引擎（player.engine）、mpv 下的 RTX 视频超分（player.rtxVsr）、
 * Anime4K 超分（Anime4kRows）与缩小置顶，杜比视界 P5 自动用 mpv（player.dvAutoMpv），
 * 在线播放卡顿自动换源（online.autoSwitchSource / online.stallSeconds），
 * 杜比视界 P5 重建是否应用 RPU 动态元数据（player.applyDolbyVision），
 * 内置播放器自动跳过片头（player.autoSkipIntro）与播放时自动检测片头片尾（player.autoDetectIntro），
 * 播放弹窗的角落小窗（ui.miniPlayer），桌面端的托盘图标（app.tray）与媒体键（player.mediaKeys）。
 */
import { computed, watch } from 'vue'

import { mpvInfoRows, syncRtxVsr, useMpvPlayer } from '@/features/player'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { usePlatform } from '@/composables/use-platform'

import type { SettingValue } from '../../../../../shared/settings/schema'
import Anime4kRows from './Anime4kRows.vue'
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
const dvAutoMpv = useSetting('player.dvAutoMpv')
const autoDetectIntro = useSetting('player.autoDetectIntro')
const applyDolbyVision = useSetting('player.applyDolbyVision')
const autoSwitchSource = useSetting('online.autoSwitchSource')
const stallSeconds = useSetting('online.stallSeconds')
const stallOptions = [3, 5, 8, 10, 15].map(value => ({
  value,
  label: `${value} 秒`,
}))

// ── 系统集成（桌面端） ─────────────────────────────────────
const { isElectron } = usePlatform()
const trayIcon = useSetting('app.tray')
const mediaKeys = useSetting('player.mediaKeys')
const mediaKeysHint = navigator.userAgent.includes('Mac')
  ? '内置播放器播放时，键盘的播放 / 暂停、上一集、下一集键控制播放；需在「系统设置 → 隐私与安全性 → 辅助功能」中允许影盒'
  : '内置播放器播放时，键盘的播放 / 暂停、上一集、下一集键控制播放；不在播放时不占用'
const rtxVsrEnabled = useSetting('player.rtxVsr')
watch(rtxVsrEnabled, () => syncRtxVsr())

/** mpv 播放信息（编码、分辨率、超分、地址类型），没在播放时为空 */
const mpvInfoText = computed(() =>
  mpvInfoRows(mpvState.value)
    .map(row => `${row.label}：${row.value}`)
    .join(' · ')
)

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
