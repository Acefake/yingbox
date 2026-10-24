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
          下一集 · {{ skip.countdown.value }} 秒后播放
        </p>
        <p class="skip-next-name" :title="upNext">{{ upNext }}</p>
        <div class="skip-next-actions">
          <UiButton
            variant="primary"
            size="sm"
            label="立即播放"
            @click="skip.playNow"
          />
          <UiButton
            class="skip-next-later"
            size="sm"
            label="看完片尾"
            @click="skip.watchCredits"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 跳过片头片尾的界面层：片头里右下角的「跳过片头」，片尾里有下一集时的「下一集」倒计时卡片。
 * 状态与右键菜单、进度条区间都在 useSkipSegments；这里只负责摆放。
 *
 * - art：当前这一集的 Artplayer 实例（UnifiedVideoPlayer 的 art 事件给出）
 * - series：标记属于哪部剧（skipKey()）
 * - upNext：下一集的名字；空串表示没有下一集
 */
import type Artplayer from 'artplayer'
import { computed, watch } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import { useSkipSegments } from './use-skip-segments'

const props = defineProps<{
  art: Artplayer | null
  series: string
  upNext: string
}>()
const emit = defineEmits<{ 'play-next': [] }>()

const skip = useSkipSegments({
  key: () => props.series,
  hasNext: () => !!props.upNext,
  playNext: () => emit('play-next'),
})

watch(() => props.art, skip.attach, { immediate: true })

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

/* 视频上的玻璃材质：深色半透明 + 背景模糊，两套主题一致 */
.skip-glass,
.skip-intro.ui-button.is-secondary {
  color: var(--media-text);
  background: var(--media-glass);
  border: 1px solid var(--media-glass-border);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(var(--blur-media));
  -webkit-backdrop-filter: blur(var(--blur-media));
}

.skip-intro.ui-button:hover:not(:disabled) {
  background: var(--media-hover);
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
