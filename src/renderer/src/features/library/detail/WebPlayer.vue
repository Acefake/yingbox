<template>
  <Teleport to="body">
    <div
      v-if="visible && playback"
      class="web-player"
      role="dialog"
      aria-modal="true"
      :aria-label="playback.title"
    >
      <header class="web-player__bar">
        <span class="web-player__title">
          {{ playback.title }}
          <template v-if="playback.sources.length > 1">
            · {{ current?.name }}
          </template>
        </span>
        <UiIconButton
          v-if="playback.sources.length > 1"
          icon="skipBack"
          label="上一个"
          variant="overlay"
          :disabled="playback.index === 0"
          @click="seekWebPlayer(playback.index - 1)"
        />
        <UiIconButton
          v-if="playback.sources.length > 1"
          icon="skipForward"
          label="下一个"
          variant="overlay"
          :disabled="playback.index >= playback.sources.length - 1"
          @click="seekWebPlayer(playback.index + 1)"
        />
        <UiIconButton
          v-if="canPip"
          icon="pip"
          label="画中画"
          variant="overlay"
          @click="enterPip"
        />
        <UiIconButton
          icon="close"
          label="关闭"
          variant="overlay"
          @click="closeWebPlayer"
        />
      </header>
      <!-- <video> 由 web-player.ts 持有，放进这里；进小窗时整体搬走 -->
      <div ref="stage" class="web-player__stage" />
      <p v-if="failed" class="web-player__error" role="alert">
        浏览器无法播放这个文件（常见于 MKV / HEVC），请用桌面端的内置播放器或
        mpv。
      </p>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 网页端页内播放器：原生 <video> + 片库服务的 Range 流，按顺序连播（分段电影 / 一季的集）。
 * 桌面端不会出现（那里走内置播放器窗口或 mpv）。Esc 或关闭按钮退出。
 *
 * 应用内小窗：播放中关闭详情（?item= 去掉）或切走路由 → <video> 进小窗；换到别的条目、暂停中关闭详情 → 拆除。
 */
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'

import { UiIconButton } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { pipSupported } from '@/features/player'

import {
  claimWebVideo,
  closeWebPlayer,
  dockWebPlayer,
  seekWebPlayer,
  undockWebPlayer,
  webPlayback,
  webPlaybackFailed,
  webVideo,
} from './web-player'

const playback = webPlayback()
const failed = webPlaybackFailed()
const current = computed(() =>
  playback.value ? playback.value.sources[playback.value.index] : null
)
const stage = ref<HTMLElement | null>(null)
const canPip = pipSupported()
/** keep-alive 缓存着的其它媒体库页也挂着本组件，只有当前页的去拿 <video> */
const active = ref(true)
onActivated(() => (active.value = true))
onDeactivated(() => (active.value = false))
const visible = computed(() => active.value && !playback.value?.docked)
useEscapeLayer(() => visible.value && playback.value !== null, closeWebPlayer)

// 播放层出现：认领 <video> 放进来并聚焦（键盘可直接控制）
watch(stage, el => {
  if (!el) return
  const video = claimWebVideo()
  el.appendChild(video)
  video.focus()
})

const enterPip = (): void => {
  void webVideo()
    .requestPictureInPicture()
    .catch(() => {})
}

const route = useRoute()
const router = useRouter()

/** 播放中就进小窗；「回到详情」= 回到此刻的地址并重新显示播放层 */
const dock = (): boolean => {
  const path = route.fullPath
  return dockWebPlayer(() => {
    void router.push(path).finally(undockWebPlayer)
  })
}

onBeforeRouteLeave(() => {
  if (visible.value && playback.value) dock()
})
onBeforeRouteUpdate(to => {
  if (!visible.value || !playback.value) return
  if (to.query.item === route.query.item) return
  // 关闭详情：播放中进小窗，否则拆除；换到别的条目：拆除
  if (to.query.item == null && dock()) return
  closeWebPlayer()
})
</script>

<style scoped>
.web-player {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-overlay);
  display: flex;
  flex-direction: column;
  background: #000; /* style-tokens: layout（视频底色恒为纯黑） */
}
.web-player__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  color: #fff; /* style-tokens: layout（叠在黑底上） */
}
.web-player__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.web-player__stage {
  flex: 1;
  min-height: 0;
}
.web-player__stage :deep(.web-player__video) {
  width: 100%;
  height: 100%;
  outline: none;
}
.web-player__error {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
