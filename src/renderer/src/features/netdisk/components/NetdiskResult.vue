<template>
  <li class="netdisk-result">
    <div class="netdisk-result-text">
      <p class="netdisk-result-title" :title="item.title">{{ item.title }}</p>
      <p class="netdisk-result-meta">
        <span v-for="part in meta" :key="part">{{ part }}</span>
      </p>
    </div>
    <div class="netdisk-result-actions">
      <UiIconButton
        icon="copy"
        label="复制链接"
        size="sm"
        @click="emit('copy')"
      />
      <UiIconButton
        icon="eye"
        :label="previewing ? '收起文件' : '查看文件'"
        size="sm"
        :active="previewing"
        :loading="previewLoading"
        @click="emit('preview')"
      />
      <UiButton
        size="sm"
        icon="save"
        :label="saved ? '已转存' : '转存'"
        :disabled="saved || saving"
        :loading="saving"
        @click="emit('save')"
      />
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * 网盘搜索的一条结果（虚拟列表里的一行，等高）：标题、来源 · 时间 · 提取码，复制链接 / 查看文件 / 转存。
 * 状态与请求都在页面的 useShareActions 里，这里只显示并发出事件。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import { formatDay, sourceLabel } from '../utils/netdisk-rules'

const props = defineProps<{
  item: NetdiskItem
  /** 这一条正显示在预览区 */
  previewing: boolean
  previewLoading: boolean
  saving: boolean
  saved: boolean
}>()
const emit = defineEmits<{ copy: []; preview: []; save: [] }>()

const meta = computed(() =>
  [
    sourceLabel(props.item.source),
    formatDay(props.item.datetime),
    props.item.receiveCode ? `提取码 ${props.item.receiveCode}` : '',
  ].filter(Boolean)
)
</script>

<style scoped>
.netdisk-result {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--bg-fill-secondary);
}
.netdisk-result-text {
  flex: 1;
  min-width: 0;
}
.netdisk-result-title,
.netdisk-result-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-result-title {
  margin: 0;
  color: var(--text-primary);
}
.netdisk-result-meta {
  display: flex;
  gap: var(--space-3);
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
.netdisk-result-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
