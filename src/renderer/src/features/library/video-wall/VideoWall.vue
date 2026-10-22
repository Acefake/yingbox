<template>
  <Teleport to="body">
    <div
      ref="root"
      class="video-wall"
      :class="{ 'is-idle': idle && !wall.paused.value }"
      role="dialog"
      aria-modal="true"
      aria-label="视频墙"
      :style="{ '--wall-columns': String(wall.columns) }"
      @mousemove="wake"
    >
      <div class="video-wall-grid">
        <div
          v-for="(cell, slot) in wall.cells.value"
          :key="slot"
          class="video-wall-tile"
          :class="{ 'is-selected': slot === wall.selected.value }"
        >
          <img
            v-if="cell.poster"
            class="video-wall-poster"
            :src="cell.poster"
            alt=""
            decoding="async"
            draggable="false"
          />
          <div
            :ref="el => wall.setHost(slot, el)"
            class="video-wall-layer ui-preview-layer"
          />
          <UiPressable
            class="video-wall-open"
            :label="`打开${cell.title}`"
            @click="emit('open', cell.id)"
          />
          <div class="video-wall-caption">
            <span class="video-wall-title">{{ cell.title }}</span>
            <UiIconButton
              icon="play"
              label="播放"
              variant="overlay"
              size="sm"
              @click="wall.playItem(cell.id)"
            />
          </div>
        </div>
      </div>
      <div class="video-wall-bar">
        <UiSegmented
          v-model="wall.maxLive.value"
          size="sm"
          label="同时播放"
          :options="wall.liveOptions"
        />
        <UiButton
          :icon="wall.paused.value ? 'play' : 'pause'"
          :label="wall.paused.value ? '继续' : '暂停'"
          variant="secondary"
          @click="wall.togglePause"
        />
        <UiIconButton
          icon="close"
          label="退出视频墙"
          variant="overlay"
          @click="emit('close')"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 视频墙：全屏网格，每格静音循环播一部影片的片段，播完换下一部（运行逻辑见 use-video-wall.ts）。
 *
 * - 海报垫底，片段开始播放后淡入；悬停或键盘选中显示片名与「播放」；点格打开详情；
 * - 右上角：同时播放上限、暂停全部、退出；鼠标静止 2.5 秒后连同指针一起隐去（暂停时常显）。
 */
import { onBeforeUnmount, ref } from 'vue'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import { useVideoWall } from './use-video-wall'

/** 鼠标静止多久隐去控件 */
const IDLE_MS = 2500

const props = defineProps<{ items: LibraryItemSummary[] }>()
const emit = defineEmits<{ close: []; open: [itemId: number] }>()

const root = ref<HTMLElement | null>(null)
const wall = useVideoWall({
  items: props.items,
  root,
  onClose: () => emit('close'),
  onOpen: id => emit('open', id),
})

const idle = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | undefined

function wake(): void {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => (idle.value = true), IDLE_MS)
}

wake()
onBeforeUnmount(() => clearTimeout(idleTimer))
</script>

<style scoped src="./video-wall.css"></style>
