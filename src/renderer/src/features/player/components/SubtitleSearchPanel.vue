<template>
  <div class="unified-player-subtitle-panel">
    <DialogTitlebar title="字幕" icon="subtitle" @close="emit('close')" />
    <!-- 面板顶部的附加区（AI 生成字幕） -->
    <slot />
    <div class="usp-search-row">
      <UiInput
        v-model="query"
        v-enter="() => emit('search')"
        class="usp-input"
        size="sm"
        placeholder="在线搜索（OpenSubtitles）…"
      />
      <UiButton
        size="sm"
        icon="search"
        :label="searching ? '搜索中…' : '搜索'"
        :loading="searching"
        @click="emit('search')"
      />
    </div>
    <p v-if="message" class="usp-msg">{{ message }}</p>
    <div class="usp-list">
      <UiListRow
        v-for="hit in hits"
        :key="hit.fileId"
        class="usp-item"
        :disabled="downloadingId === hit.fileId"
        @click="emit('pick', hit)"
      >
        <span class="usp-item-name">{{ hit.name }}</span>
        <template #description>
          <span class="usp-item-meta">
            <UiIcon name="download" size="sm" />{{ hit.downloads }}
            <template v-if="hit.rating">
              · <UiIcon name="star" size="sm" filled />{{ hit.rating }}
            </template>
            · {{ hit.format }}
            {{ downloadingId === hit.fileId ? '· 下载中…' : '' }}
          </span>
        </template>
      </UiListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 字幕面板：顶部附加区（默认插槽，放 AI 生成字幕）+ 在线字幕（OpenSubtitles）搜索框与结果列表。
 * 只负责展示，状态与下载在 usePlayerSubtitles。
 */
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import { vEnter } from '@/directives/enter'

import type { OnlineSubtitleHit } from '../composables/use-player-subtitles'

defineProps<{
  /** 搜索结果 */
  hits: OnlineSubtitleHit[]
  /** 是否正在搜索 */
  searching: boolean
  /** 正在下载的字幕 fileId */
  downloadingId: number | null
  /** 提示或错误信息 */
  message: string
}>()
const emit = defineEmits<{
  search: []
  pick: [hit: OnlineSubtitleHit]
  close: []
}>()

/** 搜索关键词（v-model:query） */
const query = defineModel<string>('query', { required: true })
</script>

<style scoped>
.unified-player-subtitle-panel {
  position: absolute;
  right: var(--space-3);
  bottom: 56px; /* style-tokens: layout（避开底部控制栏） */
  z-index: var(--z-popover);
  width: min(360px, 86vw);
  max-height: min(420px, 60vh);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  overflow: hidden;

  backdrop-filter: none;
}

.usp-search-row {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.usp-input {
  flex: 1;
}

.usp-msg {
  margin: 0 var(--space-3) var(--space-2);
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.usp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-2) var(--space-2);
}

/* 结果行为 UiListRow：这里只保留紧凑尺寸和面板内的填充底 */
.usp-item {
  padding: var(--space-2) var(--space-2);
  margin-bottom: var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  color: inherit;
}

.usp-item:hover:not(:disabled) {
  background: var(--bg-glass-hover);
}

.usp-item:disabled {
  opacity: 0.6;
}

.usp-item-name {
  display: block;
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usp-item-meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.usp-item-meta .app-icon {
  width: 11px;
  height: 11px;
}
</style>
