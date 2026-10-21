<template>
  <div class="folder-browser">
    <div class="folder-browser__bar">
      <UiIconButton
        icon="back"
        label="上一级"
        size="sm"
        :disabled="!canGoUp || loading"
        @click="goUp"
      />
      <span class="folder-browser__path" :title="listing?.path ?? ''">
        {{ listing?.path ?? '媒体根目录' }}
      </span>
    </div>
    <p v-if="error" class="folder-browser__hint is-error">{{ error }}</p>
    <p v-else-if="loading" class="folder-browser__hint">正在读取…</p>
    <p v-else-if="listing && !listing.dirs.length" class="folder-browser__hint">
      没有子文件夹
    </p>
    <ul v-else class="folder-browser__list" aria-label="子文件夹">
      <li v-for="dir in listing?.dirs ?? []" :key="dir.path">
        <UiListRow @click="open(dir.path)">
          <template #leading><UiIcon name="folder" /></template>
          {{ dir.name }}
        </UiListRow>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 网页端的文件夹选择：在片库服务的媒体根目录里逐级进入（服务端 /api/fs/dirs）。
 * 当前所在的文件夹就是选中的文件夹，经 select 事件告诉调用方（folder-picker.ts）。
 */
import { computed, onMounted, ref } from 'vue'

import type { DirectoryListing } from '../../../../../shared/library/ipc'
import { UiIcon, UiIconButton, UiListRow } from '@/components/ui'
import { fetchDirectory } from './folder-api'

const emit = defineEmits<{ select: [path: string | null] }>()

const listing = ref<DirectoryListing | null>(null)
const loading = ref(false)
const error = ref('')

const canGoUp = computed(() => Boolean(listing.value?.path))

async function load(path: string | null): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    listing.value = await fetchDirectory(path)
    emit('select', listing.value.path)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function open(path: string): void {
  void load(path)
}

function goUp(): void {
  void load(listing.value?.parent ?? null)
}

onMounted(() => void load(null))
</script>

<style scoped>
.folder-browser {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
}
.folder-browser__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.folder-browser__path {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-browser__list {
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.folder-browser__hint {
  margin: 0;
  padding: var(--space-4) 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}
.folder-browser__hint.is-error {
  color: var(--danger);
}
</style>
