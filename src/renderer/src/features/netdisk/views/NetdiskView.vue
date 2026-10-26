<template>
  <div class="netdisk-view">
    <PageHeader
      title="网盘搜索"
      :count="items.length || undefined"
      description="用 PanSou 搜 115 分享，查看文件后一键转存到自己的 115"
    >
      <template #actions>
        <UiButton
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
      title="网盘需要桌面端或片库服务"
      hint="网页版要连上片库服务才能登录 115"
    />
    <StatusState
      v-else-if="!pansouUrl"
      icon="search"
      title="先设置 PanSou 地址"
      hint="网盘搜索通过 PanSou 聚合各频道的 115 分享。在设置 · 网盘里填自部署的地址，或选用公共实例。"
    >
      <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
    </StatusState>
    <template v-else>
      <form class="netdisk-search" role="search" @submit.prevent="search">
        <UiInput
          v-model="keyword"
          class="netdisk-search-input"
          variant="filled"
          icon="search"
          clearable
          aria-label="搜索 115 分享"
          placeholder="片名、剧名…"
        />
        <!-- UiButton 固定 type="button"：点击只走 @click，回车走表单 submit，不会一次搜两遍 -->
        <UiButton
          class="netdisk-search-go"
          variant="primary"
          size="lg"
          label="搜索"
          :loading="loading"
          :disabled="!keyword.trim()"
          @click="search"
        />
      </form>

      <NetdiskPreview
        v-if="preview.item.value"
        :item="preview.item.value"
        :snap="preview.snap.value"
        :loading="preview.loading.value"
        :saving="actions.isSaving(preview.item.value.url)"
        :saved="actions.isSaved(preview.item.value.url)"
        @save="actions.save(preview.item.value)"
        @close="actions.closePreview"
      />

      <StatusState v-if="error" tone="danger" title="搜索失败" :hint="error">
        <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
      </StatusState>
      <StatusState
        v-else-if="searched && !loading && !items.length"
        icon="search"
        title="没有找到 115 分享"
        hint="换个关键词，或在设置里换一个 PanSou 地址"
      />
      <UiVirtualGrid
        v-else
        tag="ul"
        class="netdisk-results"
        :items="items"
        :item-key="item => `${item.shareCode}/${item.receiveCode}`"
      >
        <template #default="{ item }">
          <NetdiskResult
            :item="item"
            :previewing="preview.item.value?.url === item.url"
            :preview-loading="
              preview.loading.value && preview.item.value?.url === item.url
            "
            :saving="actions.isSaving(item.url)"
            :saved="actions.isSaved(item.url)"
            @copy="actions.copy(item)"
            @preview="togglePreview(item)"
            @save="actions.save(item)"
          />
        </template>
      </UiVirtualGrid>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 网盘搜索页：关键词 → PanSou（只要 115）→ 结果列表（虚拟列表，行等高）；
 * 查看文件是一个玻璃浮层（NetdiskPreview），转存在结果卡片与浮层上。
 * 没填 PanSou 地址时引导去设置；需要 115 登录的操作未登录时由主进程返回提示。
 */
import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { toast } from '@/components/ui/toast'
import { useSetting } from '@/features/settings'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import { netdisk, netdiskAvailable, openNetdiskSettings } from '../api'
import NetdiskPreview from '../components/NetdiskPreview.vue'
import NetdiskResult from '../components/NetdiskResult.vue'
import { useNetdiskSearch } from '../composables/use-netdisk-search'
import { useShareActions } from '../composables/use-share-actions'

const available = netdiskAvailable
const pansouUrl = useSetting('pan115.pansouUrl')
const { keyword, items, loading, searched, error, search } =
  useNetdiskSearch(netdisk)
const actions = useShareActions({
  api: netdisk,
  notify: toast,
  clipboard: () => navigator.clipboard,
})
const preview = actions.preview

/** 再点同一条收起预览，点别的换成那一条 */
function togglePreview(item: NetdiskItem): void {
  if (preview.item.value?.url === item.url) actions.closePreview()
  else void actions.openPreview(item)
}
</script>

<style scoped>
.netdisk-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: calc(1136px + 2 * var(--content-padding-x));
  padding: var(--content-padding-y) var(--content-padding-x);
}
.netdisk-search {
  display: flex;
  gap: var(--space-3);
}
.netdisk-search-input {
  flex: 1;
  height: var(--control-height-lg);
  padding: 0 var(--space-4) 0 var(--space-5);
  border-radius: var(--radius-full);
  background: var(--bg-fill-tertiary);
  font-size: var(--text-md);
}
.netdisk-search-go {
  flex: none;
}
.netdisk-results {
  margin: 0;
  list-style: none;
  padding-inline: 0;
}
</style>
