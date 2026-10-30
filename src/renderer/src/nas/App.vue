<template>
  <NasLayout>
    <router-view v-slot="{ Component }">
      <keep-alive><component :is="Component" /></keep-alive>
    </router-view>
  </NasLayout>
  <PlayerModal />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { toast } from '@/components/ui/toast'
import NasLayout from './Layout.vue'

const PlayerModal = defineAsyncComponent({
  loader: () => import('@/features/player/modal/PlayerModal.vue'),
  onError(_error, _retry, fail) {
    toast.error('播放器加载失败，请刷新后重试')
    fail()
  },
})
</script>
