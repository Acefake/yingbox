<template>
  <div class="dav-picker">
    <UiSelect
      v-if="sources.length > 1"
      v-model="sourceId"
      size="sm"
      aria-label="WebDAV 源"
      :options="sourceOptions"
    />
    <div class="dav-picker__bar">
      <UiIconButton
        icon="back"
        label="上一级"
        size="sm"
        :disabled="parent === null || loading"
        @click="goUp"
      />
      <span class="dav-picker__path" :title="path">{{ path }}</span>
    </div>
    <p v-if="error" class="dav-picker__hint is-error">{{ error }}</p>
    <p v-else-if="loading" class="dav-picker__hint">正在读取…</p>
    <p v-else-if="!dirs.length" class="dav-picker__hint">没有子文件夹</p>
    <ul v-else class="dav-picker__list" aria-label="子文件夹">
      <li v-for="dir in dirs" :key="dir">
        <UiListRow @click="open(dir)">
          <template #leading><UiIcon name="folder" /></template>
          {{ dir }}
        </UiListRow>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 选远程媒体库文件夹（放在 confirmDialog 里）：选源、逐级进入文件夹，当前所在的文件夹就是选中的，
 * 经 select 事件告诉调用方（WebDavGroup）。目录列表由主进程带凭据 PROPFIND 得到。
 */
import { computed, ref, watch } from 'vue'

import type { WebDavSourceInfo } from '../../../../../shared/contract/webdav'
import { UiIcon, UiIconButton, UiListRow } from '@/components/ui'
import UiSelect from '@/components/ui/UiSelect.vue'

import { webdavApi } from './webdav-api'
import { parentPath } from './webdav-rules'

const props = defineProps<{ sources: WebDavSourceInfo[] }>()
const emit = defineEmits<{
  select: [selection: { source: WebDavSourceInfo; path: string } | null]
}>()

const sourceId = ref(props.sources[0]?.id ?? '')
const path = ref('/')
const dirs = ref<string[]>([])
const loading = ref(false)
const error = ref('')

const sourceOptions = computed(() =>
  props.sources.map(s => ({ value: s.id, label: s.name }))
)
const parent = computed(() => parentPath(path.value))

/** 读一个目录；成功后它就是选中的文件夹。 */
async function load(next: string): Promise<void> {
  const api = webdavApi()
  const source = props.sources.find(s => s.id === sourceId.value)
  if (!api || !source) return
  loading.value = true
  error.value = ''
  try {
    const probe = await api.listDirs(source.id, next)
    if (!probe.ok) {
      error.value = probe.message
      emit('select', null)
      return
    }
    path.value = next
    dirs.value = probe.dirs
    emit('select', { source, path: next })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    emit('select', null)
  } finally {
    loading.value = false
  }
}

function open(name: string): void {
  void load(`${path.value === '/' ? '' : path.value}/${name}`)
}

function goUp(): void {
  if (parent.value !== null) void load(parent.value)
}

watch(sourceId, () => void load('/'), { immediate: true })
</script>

<style scoped>
.dav-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
}
.dav-picker__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.dav-picker__path {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dav-picker__list {
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.dav-picker__hint {
  margin: 0;
  padding: var(--space-4) 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}
.dav-picker__hint.is-error {
  color: var(--danger);
}
</style>
