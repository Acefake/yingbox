<template>
  <div class="live-stage">
    <div class="live-stage-player">
      <UnifiedVideoPlayer
        v-if="channel && src && !failed"
        :key="attempt"
        :src="src"
        :title="channel.name"
        :hls="isLikelyHls(src)"
        :show-footer="false"
        :closable="false"
        @error="onPlayerError"
        @timeupdate="onPlaying"
      />
      <StatusState
        v-else-if="channel && failed"
        icon="warning"
        tone="danger"
        title="所有线路都无法播放"
        hint="稍后重试，或在直播源里换一个播放列表"
      >
        <UiButton icon="refresh" label="重试" size="sm" @click="retry" />
      </StatusState>
      <StatusState v-else icon="livePlay" title="选择一个频道开始观看" />
      <span
        v-if="channel && src && !failed"
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
 * 直播播放区：圆角画面（内嵌统一播放器 HLS，左上角玻璃「直播」标）+ 频道信息与收藏 + 线路切换 + 今日节目单卡片。
 * 当前线路报错或 20 秒内没开始播放，自动切到下一条线路；全部失败后显示重试。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { toast } from '@/components/ui/toast'
import { UnifiedVideoPlayer } from '@/features/player'

import { currentProgramme, formatClock } from '../utils/epg-rules'
import { isLikelyHls, nextLine } from '../utils/live-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import LiveSchedule from './LiveSchedule.vue'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

/** 开播超时：超过这么久还没有画面就当作线路失败 */
const START_TIMEOUT_MS = 20_000

const props = defineProps<{
  channel: LiveChannel | null
  programmes: EpgProgramme[] | undefined
  now: number
  favorite: boolean
  scheduleEmptyText: string
}>()

const emit = defineEmits<{ 'toggle-favorite': [id: string] }>()

const line = ref(0)
const failed = ref(false)
/** 重试时换 key，强制重建播放器 */
const attempt = ref(0)
let startTimer: ReturnType<typeof setTimeout> | undefined
let started = false
/** 最近一次换地址的时间：旧播放器销毁前补发的错误不算新线路失败 */
let switchedAt = 0
/** 换线后这段时间内的错误视为上一条线路的余波 */
const ERROR_GRACE_MS = 300

const src = computed(() => props.channel?.urls[line.value] ?? '')

const nowText = computed(() => {
  const p = currentProgramme(props.programmes, props.now)
  if (!p) return '暂无节目信息'
  return `正在播出：${p.title || '未知节目'} · ${formatClock(p.start)}–${formatClock(p.stop)}`
})

function clearStartTimer(): void {
  clearTimeout(startTimer)
  startTimer = undefined
}

/** 每次换地址都重新计时 */
function armStartTimer(): void {
  clearStartTimer()
  started = false
  switchedAt = Date.now()
  if (!src.value || failed.value) return
  startTimer = setTimeout(onLineFailed, START_TIMEOUT_MS)
}

function onPlaying(): void {
  if (started) return
  started = true
  clearStartTimer()
}

function onPlayerError(): void {
  if (Date.now() - switchedAt < ERROR_GRACE_MS) return
  onLineFailed()
}

/** 当前线路失败：切下一条，没有了就停下等用户重试 */
function onLineFailed(): void {
  clearStartTimer()
  const channel = props.channel
  if (!channel || failed.value) return
  const next = nextLine(line.value, channel.urls.length)
  if (next === null) {
    failed.value = true
    return
  }
  toast.info(`线路 ${line.value + 1} 无法播放，已切换到线路 ${next + 1}`)
  line.value = next
}

function pickLine(index: number): void {
  failed.value = false
  if (index === line.value) attempt.value++
  line.value = index
  armStartTimer()
}

function retry(): void {
  failed.value = false
  line.value = 0
  attempt.value++
  armStartTimer()
}

watch(
  () => props.channel?.id,
  () => {
    failed.value = false
    line.value = 0
    armStartTimer()
  }
)

watch(src, armStartTimer, { immediate: true })

onBeforeUnmount(clearStartTimer)
</script>

<style scoped>
.live-stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: var(--space-4);
}

.live-stage-player {
  position: relative;
  flex: none;
  aspect-ratio: 16 / 9;
  max-height: 58%;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--bg-fill-tertiary);
  color: var(--media-text-secondary);
}

.live-stage-player :deep(.av-status) {
  height: 100%;
  min-height: 0;
}

.live-stage-tag {
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
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
  background: var(--bg-fill-tertiary);
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
