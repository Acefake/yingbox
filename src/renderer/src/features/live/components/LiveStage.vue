<template>
  <div class="live-stage">
    <div class="live-stage-player">
      <UnifiedVideoPlayer
        v-if="channel && plan && !failed"
        :key="attempt"
        :src="plan.src"
        :title="channel.name"
        :hls="plan.mode === 'hls'"
        :show-footer="false"
        :closable="false"
        @error="onPlayerError"
        @timeupdate="onPlaying"
      />
      <StatusState
        v-else-if="channel && failed"
        icon="warning"
        tone="danger"
        title="所有线路都无法在内置播放器播放"
        :hint="summary"
      >
        <div class="live-stage-actions">
          <UiButton icon="refresh" label="重试" size="sm" @click="retry" />
          <UiButton
            v-if="mpvAvailable"
            icon="externalLink"
            label="用 mpv 播放"
            size="sm"
            @click="openInMpv"
          />
        </div>
      </StatusState>
      <StatusState
        v-else-if="channel && probing"
        icon="livePlay"
        :title="`正在连接线路 ${line + 1}…`"
      />
      <StatusState v-else icon="livePlay" title="选择一个频道开始观看" />
      <span
        v-if="channel && plan && !failed"
        class="live-stage-tag yb-glass is-media"
        aria-hidden="true"
        ><i />直播</span
      >
    </div>

    <div v-if="channel" class="live-stage-info">
      <div class="live-stage-text">
        <h2 class="live-stage-name">{{ channel.name }}</h2>
        <p class="live-stage-now">{{ nowText }}</p>
      </div>
      <UiIconButton
        v-if="mpvAvailable"
        icon="externalLink"
        label="用 mpv 打开（有画面没声音、卡顿时可试）"
        @click="openInMpv"
      />
      <UiButton
        class="live-stage-fav"
        :class="{ 'is-on': favorite }"
        :aria-pressed="favorite"
        @click="emit('toggle-favorite', channel.id)"
      >
        <UiIcon name="star" size="sm" :filled="favorite" />
        {{ favorite ? '已收藏' : '收藏' }}
      </UiButton>
    </div>

    <div
      v-if="channel && channel.urls.length > 1"
      class="live-stage-lines"
      role="group"
      aria-label="线路"
    >
      <UiChip
        v-for="(_, index) in channel.urls"
        :key="index"
        :label="`线路 ${index + 1}`"
        :selected="index === line && !failed"
        :title="reasons[index]"
        @click="pickLine(index)"
      />
    </div>

    <LiveSchedule
      v-if="channel"
      class="live-stage-schedule"
      :programmes="programmes"
      :now="now"
      :empty-text="scheduleEmptyText"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 直播播放区：圆角画面（内嵌统一播放器，右上角玻璃「直播」标）+ 频道信息、mpv 打开与收藏 + 线路切换 + 今日节目单卡片。
 * 线路的探测、换线与失败原因在 useLiveLine；全部失败时列出每条线路的原因，可一键改用 mpv。
 */
import { computed, toRef } from 'vue'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { toast } from '@/components/ui/toast'
import { UnifiedVideoPlayer, useMpvPlayer } from '@/features/player'

import { useLiveLine } from '../composables/use-live-line'
import { currentProgramme, formatClock } from '../utils/epg-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import LiveSchedule from './LiveSchedule.vue'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

const props = defineProps<{
  channel: LiveChannel | null
  programmes: EpgProgramme[] | undefined
  now: number
  favorite: boolean
  scheduleEmptyText: string
}>()

const emit = defineEmits<{ 'toggle-favorite': [id: string] }>()

const {
  line,
  failed,
  attempt,
  plan,
  probing,
  reasons,
  summary,
  url,
  pickLine,
  retry,
  onPlaying,
  onPlayerError,
} = useLiveLine(toRef(props, 'channel'))

const mpv = useMpvPlayer()
const mpvAvailable = mpv.canUseMpv()

/** 当前线路交给 mpv（FLV / TS / 组播、HEVC、MP2 / AC3 音频都能播） */
async function openInMpv(): Promise<void> {
  const target = url.value
  if (!target) return
  const ok = await mpv.openMpv({ url: target, title: props.channel?.name })
  if (!ok)
    toast.warning('未检测到 mpv 播放器，可在「设置 → 播放器」安装或指定路径')
}

const nowText = computed(() => {
  const p = currentProgramme(props.programmes, props.now)
  if (!p) return '暂无节目信息'
  return `正在播出：${p.title || '未知节目'} · ${formatClock(p.start)}–${formatClock(p.stop)}`
})
</script>

<style scoped>
.live-stage {
  /* 播放区按这块的高度限宽：尺寸查询容器（本组件是 grid 行里拉伸的格子，高度由外层给定） */
  container-type: size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: var(--space-4);
}

.live-stage-player {
  position: relative;
  flex: none;
  align-self: flex-start;
  /* 宽度取「整行」与「58% 高度对应的 16:9 宽度」中较小者，矮窗口里整体缩小而不是被截成宽扁框 */
  width: min(100%, 58cqh * 16 / 9);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  color: var(--text-tertiary);
}

.live-stage-player :deep(.av-status) {
  height: 100%;
  min-height: 0;
}

/* 右上角：左上角留给播放器自己的提示 */
.live-stage-tag {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  height: 26px;
  padding: 0 var(--space-2_5);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  pointer-events: none;
}

.live-stage-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}

.live-stage-tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}

.live-stage-info {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-1);
}

.live-stage-text {
  flex: 1;
  min-width: 0;
}

.live-stage-name {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}

.live-stage-now {
  margin: var(--space-0_5) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-stage-fav {
  flex: none;
  border-radius: var(--radius-full);
  background: var(--control-bg);
  box-shadow: var(--shadow-control);
}

.live-stage-fav :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
}

.live-stage-fav.is-on .app-icon {
  color: var(--rating);
}

.live-stage-lines {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0 var(--space-1);
}

.live-stage-schedule {
  flex: 1;
}
</style>
