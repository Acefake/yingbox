<template>
  <li class="netdisk-result">
    <div class="netdisk-result-main">
      <div class="netdisk-result-text">
        <p class="netdisk-result-title" :title="item.title">{{ item.title }}</p>
        <p class="netdisk-result-meta">
          <span v-for="part in meta" :key="part">{{ part }}</span>
        </p>
      </div>
      <div class="netdisk-result-actions">
        <UiIconButton icon="copy" label="复制链接" size="sm" @click="copy" />
        <UiIconButton
          icon="eye"
          :label="snap ? '收起文件' : '查看文件'"
          size="sm"
          :active="Boolean(snap)"
          :loading="previewing"
          @click="togglePreview"
        />
        <UiButton
          size="sm"
          icon="save"
          :label="saved ? '已转存' : '转存'"
          :disabled="saved"
          :loading="saving"
          @click="save"
        />
      </div>
    </div>
    <ul v-if="snap" class="netdisk-result-files">
      <li v-for="file in snap.files" :key="file.id" class="netdisk-result-file">
        <UiIcon :name="file.isDir ? 'folder' : 'file'" size="sm" />
        <span class="netdisk-result-file-name">{{ file.name }}</span>
        <span class="netdisk-result-file-size">{{
          formatBytes(file.size)
        }}</span>
      </li>
      <li v-if="snap.count > snap.files.length" class="netdisk-result-more">
        共 {{ snap.count }} 项，只显示前 {{ snap.files.length }} 项
      </li>
    </ul>
  </li>
</template>

<script setup lang="ts">
/**
 * 网盘搜索的一条结果：标题、来源 · 时间 · 提取码，复制链接 / 查看文件 / 转存。
 * 预览与转存都在主进程（带 115 登录），失败用轻提示说明原因。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { toast } from '@/components/ui/toast'
import type {
  NetdiskItem,
  ShareSnap,
} from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'
import { formatBytes, formatDay, sourceLabel } from '../utils/netdisk-rules'

const props = defineProps<{ item: NetdiskItem }>()

const snap = ref<ShareSnap | null>(null)
const previewing = ref(false)
const saving = ref(false)
const saved = ref(false)

const meta = computed(() =>
  [
    sourceLabel(props.item.source),
    formatDay(props.item.datetime),
    props.item.receiveCode ? `提取码 ${props.item.receiveCode}` : '',
  ].filter(Boolean)
)

async function copy(): Promise<void> {
  const { url, receiveCode } = props.item
  const text =
    receiveCode && !url.includes('password=')
      ? `${url} 提取码：${receiveCode}`
      : url
  await navigator.clipboard.writeText(text)
  toast.success('已复制链接')
}

async function togglePreview(): Promise<void> {
  if (snap.value) {
    snap.value = null
    return
  }
  previewing.value = true
  const result = await netdisk().snap(props.item.url, props.item.receiveCode)
  previewing.value = false
  if (result.ok) snap.value = result
  else toast.error(result.error)
}

async function save(): Promise<void> {
  saving.value = true
  const result = await netdisk().receive(props.item.url, props.item.receiveCode)
  saving.value = false
  if (result.ok) {
    saved.value = true
    toast.success('已转存到 115')
  } else toast.error(result.error)
}
</script>

<style scoped>
.netdisk-result {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--bg-fill-secondary);
}
.netdisk-result-main {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.netdisk-result-text {
  flex: 1;
  min-width: 0;
}
.netdisk-result-title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.netdisk-result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}
.netdisk-result-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.netdisk-result-files {
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  list-style: none;
  border-radius: var(--radius-md);
  background: var(--bg-fill-tertiary);
}
.netdisk-result-file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.netdisk-result-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-result-file-size,
.netdisk-result-more {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.netdisk-result-more {
  padding-top: var(--space-1);
}
</style>
