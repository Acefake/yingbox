<template>
  <!-- 版本：同一作品的多份文件（不同分辨率 / 不同文件夹），选哪一份播放；误合并时拆出 -->
  <section class="lib-section">
    <h2 class="lib-section-title">版本</h2>
    <p v-if="splitFrom" class="lib-version-note">
      已单独显示，同一作品另有 {{ splitFrom }} 处文件
      <UiButton
        size="sm"
        variant="plain"
        label="恢复合并"
        @click="emit('join', node.id)"
      />
    </p>
    <ul v-if="rows.length" class="lib-versions" role="radiogroup">
      <li v-for="row in rows" :key="row.key" class="lib-version">
        <label class="lib-version-pick">
          <UiRadio
            :name="`lib-version-${node.id}`"
            :checked="row.key === current"
            @change="emit('update:modelValue', row.key || null)"
          />
          <span class="lib-version-text">
            <span class="lib-version-label">{{ row.label }}</span>
            <span
              v-if="row.folder"
              class="lib-version-folder"
              :title="row.folder"
            >
              {{ row.folder }}
            </span>
          </span>
        </label>
        <UiButton
          v-if="row.splitItemId !== null"
          size="sm"
          variant="plain"
          label="拆出"
          @click="emit('split', row.splitItemId)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的版本区块（实色圆角卡片里的单选列表）：
 * 电影列出每个版本（分辨率 · 动态范围 · 体积 + 来源文件夹），默认第一个（最好的）；
 * 剧集列出合并进来的各个来源，选一个后每集优先用它；
 * 合并了多处时每处可「拆出」单独显示，被拆出的条目可「恢复合并」。
 */
import { computed } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiRadio from '@/components/ui/UiRadio.vue'

import {
  pickVersion,
  sourceKey,
  sourceSummaries,
  versionLabel,
} from './version-rules'

const props = defineProps<{
  node: LibraryItemNode
  /** 用户选的版本 / 来源；null 为默认 */
  modelValue: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  split: [itemId: number]
  join: [itemId: number]
}>()

interface Row {
  /** 选中值；剧集的「自动」为空串 */
  key: string
  label: string
  folder: string
  /** 可拆出的本地条目；不能拆时为 null */
  splitItemId: number | null
}

const splitFrom = computed(() => props.node.merge?.splitFrom ?? 0)
const merged = computed(() => (props.node.merge?.members.length ?? 0) > 1)

const rows = computed<Row[]>(() => {
  const n = props.node
  if (n.type === 'series') {
    const sources = sourceSummaries(n)
    if (!sources.length) return []
    return [
      {
        key: '',
        label: '自动：每集用最好的版本',
        folder: '',
        splitItemId: null,
      },
      ...sources.map(s => ({
        key: sourceKey(s.member.itemId),
        label: s.label,
        folder: s.member.folder,
        splitItemId: s.member.itemId,
      })),
    ]
  }
  // 电影：每处只在它的第一个版本上给「拆出」
  const offered = new Set<number>()
  return (n.versions ?? []).map(v => {
    const canSplit = merged.value && !offered.has(v.itemId)
    offered.add(v.itemId)
    return {
      key: v.key,
      label: versionLabel(v),
      folder: v.folder,
      splitItemId: canSplit ? v.itemId : null,
    }
  })
})

/** 当前选中的行：电影按选中版本，剧集按来源（没选为「自动」）。 */
const current = computed(() =>
  props.node.type === 'series'
    ? (props.modelValue ?? '')
    : (pickVersion(props.node, props.modelValue)?.key ?? '')
)
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-version-note {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
/* 实色圆角卡片里的一列（效果图 D-3「关于」卡片的材质） */
.lib-versions {
  max-width: 1136px;
  margin: 0;
  padding: var(--space-1) var(--space-5);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  list-style: none;
}
.lib-version {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: var(--space-2) 0;
}
.lib-version + .lib-version {
  border-top: 1px solid var(--separator);
}
.lib-version-pick {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  cursor: pointer;
}
.lib-version-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.lib-version-label {
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.lib-version-folder {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
