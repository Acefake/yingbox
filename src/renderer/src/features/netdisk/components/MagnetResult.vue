<template>
  <li class="magnet-result">
    <div class="magnet-result-text">
      <p class="magnet-result-title" :title="item.title">{{ item.title }}</p>
      <p class="magnet-result-meta">
        <span class="magnet-result-origin">{{ origin }}</span>
        <span v-for="part in meta" :key="part">{{ part }}</span>
        <span v-if="specs.length" class="magnet-result-specs">
          <UiSpecBadge
            v-for="spec in specs"
            :key="spec.text"
            :variant="spec.variant"
            :text="spec.text"
          />
        </span>
      </p>
    </div>
    <div class="magnet-result-actions">
      <UiIconButton
        variant="solid"
        icon="link"
        label="复制链接"
        @click="emit('copy')"
      />
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * 网盘搜索的一条磁力 / 电驴结果（与 115 分享行同高的实色卡片）：标题、来源标签（磁力 · PanSou / 磁力 · Torznab）、
 * 来源细节 · 大小 · 做种 · 日期、从标题认出的规格标签（releaseSpecs），复制链接。
 */
import { computed } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import { releaseSpecs } from '@/components/ui/spec-badge'
import type { MagnetItem } from '../../../../../shared/contract/pan115'

import { magnetMeta, magnetOriginLabel } from '../utils/netdisk-rules'

const props = defineProps<{ item: MagnetItem }>()
const emit = defineEmits<{ copy: [] }>()

const origin = computed(() => magnetOriginLabel(props.item))
const meta = computed(() => magnetMeta(props.item))
const specs = computed(() => releaseSpecs([props.item.title]))
</script>

<style scoped>
.magnet-result {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
  padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.magnet-result-text {
  flex: 1;
  min-width: 0;
}
.magnet-result-title,
.magnet-result-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.magnet-result-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.magnet-result-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3_5);
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.magnet-result-origin {
  flex: none;
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
}
.magnet-result-specs {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
}
.magnet-result-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}
</style>
