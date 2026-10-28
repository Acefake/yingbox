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
import { defineAsyncComponent, defineComponent } from 'vue'

import { toast } from '@/components/ui/toast'
import { AssistantLauncher } from '@/features/assistant'
import { MpvLoadingOverlay } from '@/features/player'
import { AppLayout } from '@/features/shell'

/** 播放层取不回来时不占页面；失败原因用 toast 说 */
const PlayerModalLoadError = defineComponent({
  name: 'PlayerModalLoadError',
  setup(): () => null {
    return () => null
  },
})

/**
 * 播放层按需加载，Artplayer / hls.js / 弹幕不进主窗口入口。
 * 块请求失败，或 60 秒内还没回来，提示一次并停在失败态，避免播放层一直空白。
 */
const PlayerModal = defineAsyncComponent({
  loader: () => import('@/features/player/modal/PlayerModal.vue'),
  timeout: 60_000,
  errorComponent: PlayerModalLoadError,
  onError(_error, _retry, fail): void {
    toast.error('播放器加载失败')
    fail()
  },
})
</script>
