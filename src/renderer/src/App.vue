<template>
  <a-config-provider :component-size="'small'">
    <template v-if="route.name === 'OnlineDetail'">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </AppLayout>
  </a-config-provider>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
const route = useRoute()
</script>
