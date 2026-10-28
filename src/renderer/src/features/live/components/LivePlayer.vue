<template>
  <div class="live-player" :class="{ 'is-playing': playing }">
    <UnifiedVideoPlayer
      v-if="channel && plan && !failed"
      :key="attempt"
      :src="webPlayableUrl(plan.src)"
      :title="channel.name"
      :hls="plan.mode === 'hls'"
      :show-footer="false"
      :closable="false"
      @ready="onReady"
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
      <div class="live-player-actions">
        <UiButton icon="refresh" label="重试" size="sm" @click="retry" />
        <UiButton
          v-if="mpvAvailable"
          icon="externalLink"
          label="用 mpv 播放"
          size="sm"
          @click="emit('open-mpv')"
        />
      </div>
    </StatusState>
    <StatusState
      v-else-if="channel && probing"
      icon="livePlay"
      :title="`正在连接线路 ${line + 1}…`"
    />
    <StatusState v-else icon="livePlay" title="选择一个频道开始观看" />

    <template v-if="playing && channel">
      <span class="live-player-tag is-live yb-glass is-media" aria-hidden="true"
        ><i />直播</span
      >
      <span class="live-player-tag is-line yb-glass is-media">{{
        lineText
      }}</span>
      <div class="live-player-cap yb-on-media">
        <span class="yb-pblur" aria-hidden="true"><i /><i /><i /><i /></span>
        <div class="live-player-text">
          <p class="live-player-title">
            {{ status?.programme.title || channel.name }}
          </p>
          <template v-if="status">
            <p class="live-player-meta">{{ metaText }}</p>
            <span
              class="live-player-track"
              role="progressbar"
              aria-label="节目播出进度"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="Math.round(status.progress * 100)"
            >
              <span
                class="live-player-bar"
                :style="{ transform: `scaleX(${status.progress})` }"
              />
            </span>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 直播画面：16:9 圆角框里的统一播放器（线路探测 / 回退 / 全部失败的状态由 useLiveLine 给）。
 * 播放时画面上叠玻璃小标签（左上「直播」、右上「线路 x / n · 清晰度」），底部渐进模糊上压当前节目名、
 * 「频道 · 开始–结束 · 还剩 N 分钟」和播出进度；没有节目单只显示频道名。指针移入画面时说明淡出，让出播放器控制条。
 */
import { computed, ref, watch } from 'vue'
import { webPlayableUrl } from '@/services/library-server/engine'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { UnifiedVideoPlayer } from '@/features/player'

import type { LiveLineState } from '../composables/use-live-line'
import { type NowPlaying, formatClock } from '../utils/epg-rules'
import { qualityLabel } from '../utils/live-rules'
import type { LiveChannel } from '../utils/playlist-parse'

const props = defineProps<{
  channel: LiveChannel | null
  /** 线路状态（父组件的 useLiveLine，整个组件生命周期内不换对象） */
  lines: LiveLineState
  status: NowPlaying | null
  mpvAvailable: boolean
}>()

const emit = defineEmits<{ 'open-mpv': [] }>()

// 线路状态对象不会换，解构一次即可让模板自动解包
const { line, failed, attempt, plan, probing, summary, retry } = props.lines

/** 画面高度（hls 切档时随 resize 更新），换线路 / 频道时清零 */
const videoHeight = ref(0)
const playing = computed(() => !!(props.channel && plan.value && !failed.value))

watch(plan, () => {
  videoHeight.value = 0
})

function onReady(video: HTMLVideoElement): void {
  const read = (): void => {
    videoHeight.value = video.videoHeight
  }
  video.addEventListener('loadedmetadata', read)
  video.addEventListener('resize', read)
}

function onPlaying(): void {
  props.lines.onPlaying()
}

function onPlayerError(event?: Event): void {
  props.lines.onPlayerError(event)
}

const lineText = computed(() => {
  const total = props.channel?.urls.length ?? 0
  const quality = qualityLabel(videoHeight.value)
  const parts = [`线路 ${line.value + 1} / ${total}`]
  if (quality) parts.push(quality)
  return parts.join(' · ')
})

const metaText = computed(() => {
  const s = props.status
  if (!s || !props.channel) return ''
  const { programme, remainingMinutes } = s
  return `${props.channel.name} · ${formatClock(programme.start)}–${formatClock(programme.stop)} · 还剩 ${remainingMinutes} 分钟`
})
</script>

<style scoped>
.live-player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  color: var(--text-tertiary);
}

.live-player.is-playing {
  background: var(--overlay-scrim-strong);
}

.live-player :deep(.av-status) {
  height: 100%;
  min-height: 0;
}

.live-player-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}

.live-player-tag {
  position: absolute;
  top: var(--space-3_5);
  z-index: var(--z-above);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  height: 26px;
  padding: 0 var(--space-2_5);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  pointer-events: none;
}

.live-player-tag.is-live {
  left: var(--space-3_5);
  font-weight: var(--font-weight-semibold);
}

.live-player-tag.is-line {
  right: var(--space-3_5);
  font-variant-numeric: tabular-nums;
}

.live-player-tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}

/* 底部说明：不接指针，悬停 / 键盘聚焦画面时淡出，露出播放器自己的控制条 */
.live-player-cap {
  --pblur-height: 100%;
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-raised);
  height: 34%;
  color: var(--text-primary);
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.live-player:hover .live-player-cap,
.live-player:focus-within .live-player-cap {
  opacity: 0;
}

.live-player-text {
  position: absolute;
  right: var(--space-5);
  bottom: var(--space-4);
  left: var(--space-5);
}

.live-player-title {
  margin: 0;
  overflow: hidden;
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-player-meta {
  margin: var(--space-1) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-player-track {
  display: block;
  width: min(100%, 420px);
  height: 4px;
  margin-top: var(--space-2_5);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-active);
}

.live-player-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--text-primary);
  transform-origin: left center;
  transition: transform var(--duration-slow) var(--ease-out);
}
</style>
