<template>
  <div
    class="folder-prompt"
    role="group"
    :aria-label="`给 ${title} 选 115 文件夹`"
  >
    <p class="folder-prompt-text">
      全自动要先给这部剧选一个 115 文件夹，选好就切到全自动；也可以在
      <button
        type="button"
        class="folder-prompt-link"
        @click="openNetdiskSettings"
      >
        设置 · 网盘
      </button>
      里设剧集默认目录。
    </p>
    <FolderTree
      class="folder-prompt-tree"
      @select="folder => emit('pick', folder)"
    />
    <div class="folder-prompt-actions">
      <UiButton
        size="sm"
        variant="plain"
        label="取消"
        @click="emit('cancel')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 切全自动前补选文件夹（见 use-full-auto-folder.ts）：一句说明（「设置 · 网盘」可点，跳到设置的网盘分区）、
 * 115 目录树（点文件夹名即选中）、取消。挂在这部剧那一行下面，Esc 也算取消。
 */
import UiButton from '@/components/ui/UiButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { FolderTree, openNetdiskSettings } from '@/features/netdisk'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'

defineProps<{ title: string }>()
const emit = defineEmits<{ pick: [folder: TargetFolder]; cancel: [] }>()

useEscapeLayer(
  () => true,
  () => emit('cancel')
)
</script>

<style scoped>
.folder-prompt {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--bg-fill-tertiary);
}

.folder-prompt-text {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.folder-prompt-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}

.folder-prompt-link:hover {
  text-decoration: underline;
}

.folder-prompt-tree {
  max-height: 280px;
  overflow-y: auto;
}

.folder-prompt-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
