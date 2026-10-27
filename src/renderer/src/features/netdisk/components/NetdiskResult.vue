<template>
  <li class="netdisk-result">
    <QualityBadge :title="item.title" />
    <div class="netdisk-result-text">
      <p class="netdisk-result-title" :title="item.title">{{ item.title }}</p>
      <p class="netdisk-result-meta">
        <span v-for="part in meta" :key="part">{{ part }}</span>
        <span v-if="specs.length" class="netdisk-result-specs">
          <UiSpecBadge
            v-for="spec in specs"
            :key="spec.text"
            :variant="spec.variant"
            :text="spec.text"
          />
        </span>
      </p>
    </div>
    <div class="netdisk-result-actions">
      <UiIconButton
        variant="solid"
        icon="link"
        label="复制链接"
        @click="emit('copy')"
      />
      <UiIconButton
        variant="solid"
        icon="eye"
        :label="previewing ? '收起文件' : '查看文件'"
        :active="previewing"
        :loading="previewLoading"
        @click="emit('preview')"
      />
      <UiButton
        icon="download"
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
 * 网盘搜索的一条结果（虚拟列表里的一张实色卡片，等高）：左侧画质角标（QualityBadge），标题、来源 · 时间 · 提取码 · 从标题认出的规格标签，
 * 复制链接 / 查看文件 / 转存。
 * 状态与请求都在页面的 useShareActions 里，这里只显示并发出事件。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import { releaseSpecs } from '@/components/ui/spec-badge'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import QualityBadge from './QualityBadge.vue'
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
const specs = computed(() => releaseSpecs([props.item.title]))
</script>

<style scoped>
.netdisk-result {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
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
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.netdisk-result-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3_5);
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.netdisk-result-specs {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
}
.netdisk-result-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}
</style>
