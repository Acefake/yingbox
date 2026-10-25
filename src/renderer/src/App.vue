<template>
  <AppLayout>
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </AppLayout>
  <MpvLoadingOverlay />
  <MiniPlayer />
  <PlayerModal />
  <SectionLockGate />
  <AssistantLauncher />
</template>

<script setup lang="ts">
import { AssistantLauncher } from '@/features/assistant'
import { AppLayout } from '@/features/shell'
import { MiniPlayer, MpvLoadingOverlay, PlayerModal } from '@/features/player'
import { SectionLockGate } from '@/features/section-lock'
</script>
