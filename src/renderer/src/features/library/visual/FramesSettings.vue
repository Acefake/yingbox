<template>
  <!-- 视频画面：从本地视频抽帧建索引，结果能定位到时间点 -->
  <section class="frames" aria-label="视频画面">
    <div class="frames-row">
      <div class="frames-text">
        <span class="frames-title">视频画面</span>
        <span class="frames-note" aria-live="polite">
          {{ note }}
        </span>
      </div>
      <UiButton
        v-if="frames.enabled"
        size="sm"
        variant="plain"
        :icon="frames.paused ? 'play' : 'pause'"
        :label="frames.paused ? '继续' : '暂停'"
        @click="emit('change', { paused: !frames.paused })"
      />
      <UiSwitch
        :model-value="frames.enabled"
        label="从本地视频抽帧"
        @update:model-value="enabled => emit('change', { enabled })"
      />
    </div>
    <div v-if="frames.enabled" class="frames-row">
      <span class="frames-note">网盘上的库也抽帧（要读视频的多个位置）</span>
      <UiSwitch
        :model-value="frames.includeCloud"
        label="网盘上的库也抽帧"
        @update:model-value="includeCloud => emit('change', { includeCloud })"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 按画面搜面板里的「视频画面」开关：打开后后台空闲时从本地视频抽帧（每 30 秒一帧、每部最多 60 帧），
 * 可暂停 / 继续，网盘上的库默认跳过。状态文案见 visual-rules.framesText。
 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import type {
  VisualFramesSettings,
  VisualFramesStatus,
} from '../../../../../shared/library/ipc'
import { framesText } from './visual-rules'

const props = defineProps<{ frames: VisualFramesStatus }>()
const emit = defineEmits<{ change: [patch: Partial<VisualFramesSettings>] }>()

const note = computed(
  () =>
    framesText(props.frames) ||
    '从本地视频里抽画面一起搜，结果能从那个时间点播放。需要 ffmpeg。'
)
</script>

<style scoped>
.frames {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.frames-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.frames-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.frames-title {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}
.frames-note {
  flex: 1 1 auto;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
</style>
