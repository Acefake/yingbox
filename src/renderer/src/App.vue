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
  <InlinePlayer />
</template>

<script setup lang="ts">
import { AppLayout } from '@/features/shell'
import { InlinePlayer, MiniPlayer, MpvLoadingOverlay } from '@/features/player'
</script>
