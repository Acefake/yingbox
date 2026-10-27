<template>
  <div class="folder-tree" role="group" aria-label="115 文件夹">
    <template v-for="row in tree.rows.value" :key="rowKey(row)">
      <div
        v-if="row.type === 'dir'"
        class="folder-tree-row"
        :style="{ '--depth': row.depth }"
      >
        <UiIconButton
          v-if="!row.leaf"
          class="folder-tree-toggle"
          :class="{ 'is-open': row.expanded }"
          size="sm"
          icon="chevronDown"
          :label="row.expanded ? '收起' : '展开'"
          :aria-expanded="row.expanded"
          @click="tree.toggle(row.cid)"
        />
        <span v-else class="folder-tree-spacer" aria-hidden="true" />
        <UiListRow
          class="folder-tree-item"
          :selected="row.cid === selectedCid"
          :aria-current="row.cid === selectedCid ? 'true' : undefined"
          @click="emit('select', { cid: row.cid, name: nameOf(row) })"
        >
          <template #leading><UiIcon name="folder" size="sm" /></template>
          {{ row.name }}
        </UiListRow>
      </div>
      <p
        v-else
        class="folder-tree-note"
        :class="{ 'is-danger': row.tone === 'danger' }"
        :style="{ '--depth': row.depth }"
        role="status"
      >
        {{ row.text }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 115 目录树：根目录默认展开，点箭头展开 / 收起（展开时才读子文件夹，读过的按 cid 缓存，见 useFolderTree），
 * 点文件夹名直接选中（emit select），当前选中的一行用 --bg-active 标出。读取中 / 出错 / 空文件夹在该节点下显示一行说明。
 */
import { onMounted } from 'vue'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'

import { netdisk } from '../api'
import {
  type FolderTreeRow,
  useFolderTree,
} from '../composables/use-folder-tree'

defineProps<{ selectedCid?: string }>()
const emit = defineEmits<{ select: [folder: TargetFolder] }>()

const tree = useFolderTree(netdisk)

const rowKey = (row: FolderTreeRow): string =>
  row.type === 'dir' ? `dir:${row.cid}` : row.key

/** 根目录的规范形是空名字（显示时再写「根目录」） */
const nameOf = (row: FolderTreeRow & { type: 'dir' }): string =>
  row.cid === '0' ? '' : row.name

onMounted(() => void tree.start())
</script>

<style scoped>
.folder-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
}
.folder-tree-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  padding-left: calc(var(--space-4) * var(--depth));
}
.folder-tree-toggle :deep(svg) {
  transform: rotate(-90deg);
  transition: transform var(--duration-fast) var(--ease-out);
}
.folder-tree-toggle.is-open :deep(svg) {
  transform: none;
}
.folder-tree-spacer {
  flex: 0 0 var(--control-height-sm);
}
.folder-tree-item {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
}
.folder-tree-note {
  margin: 0;
  padding: var(--space-1) 0 var(--space-1)
    calc(var(--space-4) * var(--depth) + var(--control-height-sm));
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.folder-tree-note.is-danger {
  color: var(--danger);
}
</style>
