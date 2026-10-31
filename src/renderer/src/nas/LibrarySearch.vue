<template>
  <div class="nas-search-entry">
    <UiInput
      v-model="query"
      v-enter="search"
      placeholder="搜索影片与资源"
      aria-label="搜索影片与资源"
      icon="search"
      clearable
      @clear="search"
    >
      <template #trailing
        ><UiIconButton
          icon="forward"
          label="搜索影片与资源"
          size="sm"
          @click="search"
      /></template>
    </UiInput>
    <LocalSearchPreview
      v-if="
        route.path !== '/jav' && query.trim() && query.trim() !== route.query.q
      "
      :text="query"
      @complete="search"
    />
  </div>
</template>

<script setup lang="ts">
/** NAS 搜索入口：私密分区留在本地，其余进入统一资源搜索。 */
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiInput from '@/components/ui/UiInput.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { LocalSearchPreview } from '@/features/search'
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
  const path = route.path === '/jav' ? '/jav' : '/search'
  void router.push({ path, query: { q: query.value.trim() || undefined } })
}
</script>

<style scoped>
.nas-search-entry {
  position: relative;
}
</style>
