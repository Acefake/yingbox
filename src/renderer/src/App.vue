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
import { AssistantLauncher } from '@/features/assistant'
import { AppLayout } from '@/features/shell'
import { MpvLoadingOverlay, PlayerModal } from '@/features/player'
</script>
