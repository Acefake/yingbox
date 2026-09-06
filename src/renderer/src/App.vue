<template>
  <a-config-provider :theme="antdTheme" :component-size="'small'">
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
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/Layout/AppLayout.vue'
import { useTheme } from '@/utils/theme'

const route = useRoute()
const isPlayerPopout = computed(() => route.name === 'PlayerPopout')

/** Reactive Ant Design theme - updates instantly when shell toggle changes data-theme. */
const { antdTheme } = useTheme()
</script>