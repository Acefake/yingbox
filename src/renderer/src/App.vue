<template>
  <template v-if="isPlayerPopout">
    <router-view />
  </template>
  <AppLayout v-else>
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </AppLayout>
  <MpvLoadingOverlay v-if="!isPlayerPopout" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { AppLayout } from '@/features/shell'
import { MpvLoadingOverlay } from '@/features/player'

const route = useRoute()
const isPlayerPopout = computed(() => route.name === 'PlayerPopout')
</script>
