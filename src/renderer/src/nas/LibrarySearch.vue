<template>
  <UiInput
    v-model="query"
    v-enter="search"
    placeholder="搜索片库"
    aria-label="搜索片库"
    icon="search"
    clearable
    @clear="search"
  >
    <template #trailing
      ><UiIconButton icon="forward" label="搜索片库" size="sm" @click="search"
    /></template>
  </UiInput>
</template>

<script setup lang="ts">
/** 片名搜索直接进入当前片库的已有查询路径，不经过 AI 助手。 */
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiInput from '@/components/ui/UiInput.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { vEnter } from '@/directives/enter'

const route = useRoute()
const router = useRouter()
const query = ref('')
watch(
  () => route.query.q,
  value => {
    query.value = typeof value === 'string' ? value : ''
  },
  { immediate: true }
)

function search(): void {
  const path = ['/movie', '/tv', '/jav'].includes(route.path)
    ? route.path
    : '/movie'
  void router.push({ path, query: { q: query.value.trim() || undefined } })
}
</script>
