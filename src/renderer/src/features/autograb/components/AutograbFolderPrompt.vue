<template>
  <div
    class="folder-prompt"
    role="group"
    :aria-label="`给 ${title} 选 115 文件夹`"
  >
    <p v-if="global" class="folder-prompt-text">
      所有{{ kindText }}全自动前要先选{{ kindText }}默认目录（不能存到 115
      根目录），选好就切到全自动。
    </p>
    <p v-else class="folder-prompt-text">
      全自动要先给这部剧选一个 115 文件夹，选好就切到全自动；也可以在
      <UiPressable class="folder-prompt-link" @click="openNetdiskSettings">
        设置 · 网盘
      </UiPressable>
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
 * 切全自动前补选文件夹：一句说明、115 目录树（点文件夹名即选中）、取消，Esc 也算取消。
 * - 一部剧（use-full-auto-folder.ts）：挂在这部剧那一行下面，「设置 · 网盘」可点，跳到设置的网盘分区；
 * - global：全局切全自动（use-policy-folder.ts），选的是剧集 / 电影默认目录。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { FolderTree, openNetdiskSettings } from '@/features/netdisk'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'

const props = defineProps<{
  title: string
  /** 全局切全自动：选的是这个种类的默认目录 */
  global?: 'tv' | 'movie'
}>()
const kindText = computed(() => (props.global === 'movie' ? '电影' : '剧集'))
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
  color: var(--accent-text);
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
