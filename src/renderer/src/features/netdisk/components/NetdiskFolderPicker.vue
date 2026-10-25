<template>
  <div class="netdisk-picker">
    <nav class="netdisk-picker-path" aria-label="当前位置">
      <button
        v-for="(dir, index) in listing?.path ?? []"
        :key="dir.cid"
        type="button"
        class="netdisk-picker-crumb"
        :disabled="index === (listing?.path.length ?? 0) - 1"
        @click="open(dir.cid)"
      >
        {{ dir.name || '根目录' }}
      </button>
    </nav>
    <p v-if="error" class="netdisk-picker-note" role="status">{{ error }}</p>
    <p v-else-if="loading" class="netdisk-picker-note">正在读取…</p>
    <p v-else-if="!listing?.dirs.length" class="netdisk-picker-note">
      没有子文件夹
    </p>
    <div v-else class="netdisk-picker-list">
      <UiListRow
        v-for="dir in listing.dirs"
        :key="dir.cid"
        @click="open(dir.cid)"
      >
        <template #leading><UiIcon name="folder" size="sm" /></template>
        {{ dir.name }}
      </UiListRow>
    </div>
    <UiButton
      variant="primary"
      size="sm"
      label="存到这里"
      :disabled="!listing"
      @click="pickHere"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 115 文件夹选择：逐层进入，面包屑返回上层，「存到这里」选中当前文件夹。
 */
import { onMounted, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import type {
  Pan115Dir,
  Pan115DirListing,
} from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'

const emit = defineEmits<{ pick: [dir: Pan115Dir] }>()

const listing = ref<Pan115DirListing | null>(null)
const loading = ref(false)
const error = ref('')

async function open(cid: string): Promise<void> {
  loading.value = true
  error.value = ''
  const result = await netdisk().dirs(cid)
  loading.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  listing.value = result
}

function pickHere(): void {
  const current = listing.value
  if (!current) return
  const here = current.path[current.path.length - 1]
  emit('pick', { cid: current.cid, name: here?.name ?? '' })
}

onMounted(() => open('0'))
</script>

<style scoped>
.netdisk-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
}
.netdisk-picker-path {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.netdisk-picker-crumb {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.netdisk-picker-crumb:not(:last-child)::after {
  content: ' /';
  color: var(--text-tertiary);
}
.netdisk-picker-crumb:disabled {
  color: var(--text-primary);
  cursor: default;
}
.netdisk-picker-list {
  width: 100%;
  max-height: 240px;
  overflow-y: auto;
}
.netdisk-picker-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
</style>
