<template>
  <div
    v-if="text.trim()"
    class="local-search-preview"
    aria-label="片库搜索预览"
  >
    <UiMediaRow
      v-for="item in items"
      :key="item.id"
      :title="item.title"
      :year="item.year"
      :image="item.poster"
      dense
      @open="openItem(item)"
    />
    <UiLoadingDots v-if="loading" label="正在查找片库" />
    <span v-else-if="!items.length" class="local-search-empty"
      >片库暂无匹配，可搜索 115 和磁力</span
    >
    <UiButton
      size="sm"
      variant="plain"
      label="查看全部资源"
      @click="emit('complete')"
    />
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { UiButton, UiLoadingDots, UiMediaRow } from '@/components/ui'
import { findLibraryItems } from '@/features/library'
import { parseQuery } from './rules'
import type { LibraryItemSummary } from '../../../../shared/library/ipc'
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ complete: [] }>()
const router = useRouter()
const items = shallowRef<LibraryItemSummary[]>([])
const loading = ref(false)
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.text,
  text => {
    const id = ++generation
    clearTimeout(timer)
    items.value = []
    loading.value = Boolean(text.trim())
    if (!text.trim()) return
    timer = setTimeout(async () => {
      try {
        const page = await findLibraryItems('tmdb', parseQuery(text).keyword, 5)
        if (id === generation) items.value = page?.items ?? []
      } catch {
        if (id === generation) items.value = []
      } finally {
        if (id === generation) loading.value = false
      }
    }, 120)
  },
  { immediate: true }
)

function openItem(item: LibraryItemSummary): void {
  void router.push({
    path: item.type === 'series' ? '/tv' : '/movie',
    query: { item: String(item.id) },
  })
}

onScopeDispose(() => {
  generation++
  clearTimeout(timer)
})
</script>

<style scoped>
.local-search-preview {
  position: absolute;
  z-index: var(--z-dropdown);
  top: 100%;
  left: 0;
  width: max(100%, 280px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.local-search-empty {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
