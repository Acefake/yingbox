<template>
  <div class="netdisk-view">
    <PageHeader
      title="网盘搜索"
      :count="items.length || undefined"
      description="用 PanSou 搜 115 分享，查看文件后一键转存到自己的 115"
    >
      <template #actions>
        <UiIconButton
          icon="settings"
          label="网盘设置"
          :disabled="!available"
          @click="openNetdiskSettings"
        />
      </template>
    </PageHeader>

    <StatusState
      v-if="!available"
      icon="database"
      title="网盘需要桌面端"
      hint="网页版不能登录 115"
    />
    <template v-else>
      <form class="netdisk-search" role="search" @submit.prevent="search">
        <UiInput
          v-model="keyword"
          variant="filled"
          icon="search"
          clearable
          aria-label="搜索 115 分享"
          placeholder="片名、剧名…"
        />
        <UiButton
          variant="primary"
          label="搜索"
          :loading="loading"
          :disabled="!keyword.trim()"
          @click="search"
        />
      </form>

      <StatusState v-if="error" tone="danger" title="搜索失败" :hint="error">
        <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
      </StatusState>
      <StatusState
        v-else-if="searched && !loading && !items.length"
        icon="search"
        title="没有找到 115 分享"
        hint="换个关键词，或在设置里换一个 PanSou 地址"
      />
      <ul v-else class="netdisk-results">
        <NetdiskResult v-for="item in items" :key="item.url" :item="item" />
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 网盘搜索页：关键词 → PanSou（只要 115）→ 结果列表；预览与转存在每条结果上。
 * 需要 115 登录的操作未登录时由主进程返回提示，引导去设置 · 网盘扫码。
 */
import { ref } from 'vue'

import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import { netdisk, netdiskAvailable, openNetdiskSettings } from '../api'
import NetdiskResult from '../components/NetdiskResult.vue'

const available = netdiskAvailable
const keyword = ref('')
const items = ref<NetdiskItem[]>([])
const loading = ref(false)
const searched = ref(false)
const error = ref('')
/** 只认最后一次搜索的结果 */
let seq = 0

async function search(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) return
  const id = ++seq
  loading.value = true
  error.value = ''
  const result = await netdisk().search(kw)
  if (id !== seq) return
  loading.value = false
  searched.value = true
  if (result.ok) items.value = result.items
  else {
    items.value = []
    error.value = result.error
  }
}
</script>

<style scoped>
.netdisk-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 960px;
}
.netdisk-search {
  display: flex;
  gap: var(--space-3);
}
.netdisk-results {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
