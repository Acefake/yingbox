<template>
  <PlayerStage
    :session="session"
    windowed
    :toggle-pin="togglePin"
    @title="onTitle"
  />
</template>

<script setup lang="ts">
/**
 * 独立播放器窗口的根组件（player.html → src/player.ts 挂载）：主窗口发来的载荷在这里播放，
 * 换片就换一个会话（旧会话卸载时保存进度）。窗口与主窗口之间的往来在 window-client.ts。
 * 全屏用 Artplayer 的全屏（页面 HTML 全屏，Electron 让窗口跟着全屏），Esc 退出；置顶跟设置 player.windowOnTop。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import { getSetting, setSetting } from '@/features/settings'

import PlayerStage from '../stage/PlayerStage.vue'
import type { PlayerPayload } from '../utils/play-queue'
import { connectPlayerWindow } from './window-client'

const session = shallowRef<{ id: number; payload: PlayerPayload } | null>(null)
let seq = 0

const play = (payload: PlayerPayload): void => {
  session.value = { id: ++seq, payload }
}

const title = ref('')
const onTitle = (next: string): void => {
  title.value = next
  document.title = next ? `${next} · 影盒` : '影盒'
}

/** 切换置顶（设置页同一个开关），返回切换后的状态 */
const togglePin = (): boolean => {
  const on = !getSetting('player.windowOnTop')
  void setSetting('player.windowOnTop', on).catch(() => {})
  return on
}

let disconnect = (): void => {}
onMounted(() => {
  disconnect = connectPlayerWindow({
    play,
    privateSession: () => session.value?.payload.private === true,
    title: () => title.value,
  })
})
onBeforeUnmount(() => disconnect())
</script>
