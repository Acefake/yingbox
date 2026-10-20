<template>
  <footer v-if="paged" class="amane-pagination">
    <span>共 {{ total }} 项</span>
    <UiIconButton
      icon="back"
      label="上一页"
      :disabled="page === 0"
      @click="emit('page', -1)"
    />
    <span>第 {{ page + 1 }} 页</span>
    <UiIconButton
      icon="forward"
      label="下一页"
      :disabled="!hasMore(page, total)"
      @click="emit('page', 1)"
    />
  </footer>
  <footer v-else class="amane-pagination amane-pagination-auto">
    <span>共 {{ total }} 项</span
    ><span v-if="loadingMore" class="amane-muted">正在加载更多…</span
    ><span v-else-if="!hasMore(page, total)" class="amane-muted"
      >已全部加载</span
    >
  </footer>
</template>

<script setup lang="ts">
/** 列表底栏：任务视图用翻页按钮，其余视图滚动自动加载，只显示总数与加载状态。 */
import { UiIconButton } from '@/components/ui'
import { hasMore } from '../../utils/library-query'

defineProps<{
  /** true = 翻页模式（任务），false = 滚动加载 */
  paged: boolean
  page: number
  total: number
  loadingMore: boolean
}>()
const emit = defineEmits<{ page: [delta: number] }>()
</script>
