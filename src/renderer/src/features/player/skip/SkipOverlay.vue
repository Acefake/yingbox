<template>
  <!-- 挂进 Artplayer 的播放器节点：全屏时也跟着画面 -->
  <Teleport v-if="host" :to="host">
    <div class="skip-overlay">
      <UiButton
        v-if="skip.introTarget.value !== null && !skip.showNext.value"
        class="skip-glass skip-intro"
        size="lg"
        icon="skipForward"
        label="跳过片头"
        @click="skip.skipIntro"
      />
      <div
        v-if="skip.showNext.value"
        class="skip-glass skip-next"
        role="status"
        aria-live="polite"
      >
        <p class="skip-next-title">
          {{ skip.endedNext.value ? '即将播放' : '下一集' }}
          <template v-if="skip.counting.value">
            · {{ skip.countdown.value }} 秒后播放
          </template>
        </p>
        <p class="skip-next-name" :title="upNext">{{ upNext }}</p>
        <div class="skip-next-actions">
          <UiButton
            variant="primary"
            size="sm"
            label="立即播放"
            :loading="skip.switching.value"
            @click="skip.playNow"
          />
          <UiButton
            class="skip-next-later"
            size="sm"
            :label="skip.endedNext.value ? '取消' : '看完片尾'"
            @click="skip.watchCredits"
          />
        </div>
      </div>
      <div
        v-else-if="endHint"
        class="skip-glass skip-next"
        role="status"
        aria-live="polite"
      >
        <p class="skip-next-title">已播完</p>
        <p class="skip-next-name" :title="endHint.text">{{ endHint.text }}</p>
        <div class="skip-next-actions">
          <UiButton
            v-if="endHint.action"
            variant="primary"
            size="sm"
            :label="endHint.action.label"
            @click="goHint(endHint.action.to)"
          />
          <UiButton
            class="skip-next-later"
            size="sm"
            label="关闭"
            @click="emit('close-hint')"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 跳过片头片尾的界面层：片头里右下角的「跳过片头」，片尾里或播完后有下一集时的「下一集」倒计时卡片。
 * 状态与右键菜单、进度条区间都在 useSkipSegments；这里只负责摆放。
 *
 * - art：当前这一集的 Artplayer 实例（UnifiedVideoPlayer 的 art 事件给出）
 * - series：标记属于哪部剧（skipKey()）
 * - upNext：下一集的名字；空串表示没有下一集
 * - queue：播放队列；设置开着时据此在后台自动检测本季片头片尾（use-auto-detect，只认有「继续播放」记录的剧）
 * - playNext：切到下一集（PlayerSession 的 playNext），等它完成前「立即播放」显示 loading
 * - ended：这一集已播完、等着连播（卡片上是「取消」）；cancel-ended：点了「取消」
 * - endHint：播完最后一集时的提示（如媒体库剧集「没有下一集的文件」+「去追更」，按钮跳应用内地址，
 *   播放器窗口里交给主窗口打开，网页端关掉播放层再跳转）；close-hint：关掉提示
 * 设置 player.autoNext 关着时卡片照常出现，但不倒计时，要点「立即播放」。
 */
import type Artplayer from 'artplayer'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'

import {
  closePlayer,
  inPlayerWindow,
  openInMainWindow,
} from '../host/player-host'
import type { EndHint, PlaylistEntry } from '../utils/play-queue'
import { useAutoIntroDetect } from './use-auto-detect'
import { useSkipSegments } from './use-skip-segments'

const props = defineProps<{
  art: Artplayer | null
  series: string
  upNext: string
  queue?: readonly PlaylistEntry[]
  playNext: () => Promise<unknown>
  ended?: boolean
  endHint?: EndHint | null
}>()
const emit = defineEmits<{ 'cancel-ended': []; 'close-hint': [] }>()
/** 播放器窗口里没有路由：提示里的地址交给主窗口打开 */
const router = inPlayerWindow() ? null : useRouter()

function goHint(to: string): void {
  emit('close-hint')
  if (!router) return openInMainWindow(to)
  closePlayer()
  void router.push(to)
}

const skip = useSkipSegments({
  key: () => props.series,
  hasNext: () => !!props.upNext,
  playNext: () => props.playNext(),
  ended: () => props.ended === true,
  onCancelEnded: () => emit('cancel-ended'),
})

watch(() => props.art, skip.attach, { immediate: true })

// 片名每集不同、认不准是哪部剧，所以只认「继续播放」记录（c: 开头的 key）
useAutoIntroDetect(
  () => (props.series.startsWith('c:') ? props.series : ''),
  () => props.queue ?? [],
  () => props.queue?.[0]?.name ?? ''
)

const host = computed<HTMLElement | null>(
  () => skip.art.value?.template?.$player ?? null
)
</script>

<style scoped>
.skip-overlay {
  position: absolute;
  right: var(--space-6);
  bottom: var(--space-11);
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-3);
  pointer-events: none;
}

.skip-overlay > * {
  pointer-events: auto;
}

/* 视频上的玻璃材质：画面玻璃令牌（--glass-media-*），两套主题一致 */
.skip-glass,
.skip-intro.ui-button.is-secondary {
  color: var(--media-text);
  background: var(--glass-media-bg);
  border: 0;
  box-shadow: var(--glass-media-shadow);
  backdrop-filter: var(--glass-filter);
  -webkit-backdrop-filter: var(--glass-filter);
}

.skip-intro.ui-button:hover:not(:disabled) {
  background: var(--glass-media-bg-hover);
}

.skip-next {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 280px;
  padding: var(--space-4);
  border-radius: var(--radius-xl);
}

.skip-next-title {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--media-text-secondary);
}

.skip-next-name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}

.skip-next-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.skip-next-later.ui-button {
  color: var(--media-text);
  background: var(--media-hover);
}

.skip-next-later.ui-button:hover:not(:disabled) {
  background: var(--media-track);
}
</style>
