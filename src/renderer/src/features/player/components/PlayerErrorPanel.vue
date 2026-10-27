<template>
  <div class="player-session-error" role="alert">
    <p class="player-session-error-title">播放失败</p>
    <p class="player-session-error-msg">{{ message }}</p>
    <p v-if="source" class="player-session-error-src" :title="source">
      {{ source }}
    </p>
    <div class="player-session-error-actions">
      <UiButton
        v-if="canHandOff"
        variant="primary"
        icon="play"
        :label="handingOff ? '正在打开 mpv…' : '用 mpv 播放'"
        :loading="handingOff"
        @click="emit('hand-off')"
      />
      <UiButton
        :variant="canHandOff ? 'secondary' : 'primary'"
        icon="refresh"
        :label="retrying ? '重试中…' : '重试'"
        :loading="retrying"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 播放失败面板：原因、出错的条目，以及「重试」；内置解不了的编码在桌面端多一个「用 mpv 播放」。
 */
import UiButton from '@/components/ui/UiButton.vue'

defineProps<{
  /** 给用户看的失败原因 */
  message: string
  /** 出错的条目名 */
  source: string
  retrying: boolean
  /** 能不能交给 mpv（编码问题且是桌面端） */
  canHandOff: boolean
  handingOff: boolean
}>()
const emit = defineEmits<{ retry: []; 'hand-off': [] }>()
</script>

<style scoped src="./player-error-panel.css"></style>
