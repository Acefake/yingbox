<template>
  <div class="netdisk-picker">
    <nav class="netdisk-picker-path" aria-label="当前位置">
      <UiButton
        v-for="(dir, index) in listing?.path ?? []"
        :key="dir.cid"
        variant="plain"
        size="sm"
        :label="dir.name || '根目录'"
        :disabled="loading || index === (listing?.path.length ?? 0) - 1"
        @click="open(dir.cid)"
      />
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
        :disabled="loading"
        @click="open(dir.cid)"
      >
        <template #leading><UiIcon name="folder" size="sm" /></template>
        {{ dir.name }}
      </UiListRow>
      <p v-if="listing.truncated" class="netdisk-picker-note">
        文件夹太多，只显示前 {{ listing.dirs.length }} 个
      </p>
    </div>
    <UiButton
      variant="primary"
      size="sm"
      label="存到这里"
      :disabled="!canPick"
      @click="pickHere"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 115 文件夹选择：从当前转存位置打开，逐层进入，面包屑返回上层，「存到这里」选中当前文件夹。
 * 加载中禁用列表与「存到这里」；连续点击只认最后一次（见 useFolderPicker）。
 */
import { onMounted } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import type { Pan115Dir } from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'
import { useFolderPicker } from '../composables/use-folder-picker'

const props = defineProps<{ startCid: string }>()
const emit = defineEmits<{ pick: [dir: Pan115Dir] }>()

const { listing, loading, error, canPick, open, start, here } =
  useFolderPicker(netdisk)

function pickHere(): void {
  const dir = canPick.value ? here() : null
  if (dir) emit('pick', dir)
}

onMounted(() => start(props.startCid))
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
