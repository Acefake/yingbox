<template>
  <section class="netdisk-preview" aria-label="分享内容">
    <header class="netdisk-preview-head">
      <p class="netdisk-preview-title" :title="snap?.title || item.title">
        {{ snap?.title || item.title }}
      </p>
      <UiButton
        size="sm"
        icon="save"
        :label="saved ? '已转存' : '转存'"
        :disabled="saved || saving"
        :loading="saving"
        @click="emit('save')"
      />
      <UiIconButton
        icon="close"
        label="收起文件"
        size="sm"
        @click="emit('close')"
      />
    </header>
    <p v-if="loading" class="netdisk-preview-note" role="status">
      正在读取分享…
    </p>
    <ul v-else-if="snap" class="netdisk-preview-files">
      <li
        v-for="file in snap.files"
        :key="file.id"
        class="netdisk-preview-file"
      >
        <UiIcon :name="file.isDir ? 'folder' : 'file'" size="sm" />
        <span class="netdisk-preview-name">{{ file.name }}</span>
        <span class="netdisk-preview-size">{{ formatBytes(file.size) }}</span>
      </li>
      <li v-if="snap.count > snap.files.length" class="netdisk-preview-note">
        共 {{ snap.count }} 项，只显示前 {{ snap.files.length }} 项
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 网盘页的分享预览区：显示当前查看的分享的顶层文件，可直接转存或收起。
 * 放在结果列表之外，结果行保持等高（虚拟列表要求）。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type {
  NetdiskItem,
  ShareSnap,
} from '../../../../../shared/contract/pan115'

import { formatBytes } from '../utils/netdisk-rules'

defineProps<{
  item: NetdiskItem
  snap: ShareSnap | null
  loading: boolean
  saving: boolean
  saved: boolean
}>()
const emit = defineEmits<{ save: []; close: [] }>()
</script>

<style scoped>
.netdisk-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-fill-tertiary);
}
.netdisk-preview-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.netdisk-preview-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.netdisk-preview-files {
  max-height: 280px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.netdisk-preview-file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.netdisk-preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-preview-size,
.netdisk-preview-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
