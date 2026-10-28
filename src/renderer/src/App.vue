<template>
  <AppLayout>
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </AppLayout>
  <MpvLoadingOverlay />
  <PlayerModal />
  <AssistantLauncher />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

import { AssistantLauncher } from '@/features/assistant'
import { MpvLoadingOverlay } from '@/features/player'
import { AppLayout } from '@/features/shell'

/** 播放层按需加载，Artplayer / hls.js / 弹幕不进主窗口入口 */
const PlayerModal = defineAsyncComponent(
  () => import('@/features/player/modal/PlayerModal.vue')
)
</script>
