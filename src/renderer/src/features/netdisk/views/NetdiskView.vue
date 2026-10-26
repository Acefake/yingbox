<template>
  <div class="netdisk-view">
    <PageHeader
      title="网盘搜索"
      :count="items.length + magnets.length || undefined"
      description="用 PanSou / Torznab 搜 115 分享和磁力：分享查看文件后一键转存，磁力一键 115 离线下载，完成后自动入库"
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
      v-else-if="!pansouUrl && !torznabReady"
      icon="search"
      title="先设置 PanSou 或 Torznab 地址"
      hint="PanSou 聚合各频道的 115 分享和磁力，Torznab（Prowlarr / Jackett）搜 BT 站的磁力。在设置 · 网盘里填自部署的地址。"
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
          aria-label="搜索 115 分享和磁力"
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

      <div class="netdisk-tabs">
        <UiSegmented v-model="tab" :options="tabs" label="结果类型" />
        <p
          v-if="tab !== 'offline' && notes.length"
          class="netdisk-notes"
          role="status"
        >
          {{ notes.join('；') }}
        </p>
      </div>
      <OfflineTasks v-if="tab === 'offline'" />
      <StatusState
        v-else-if="error"
        tone="danger"
        title="搜索失败"
        :hint="error"
      >
        <UiButton size="sm" label="网盘设置" @click="openNetdiskSettings" />
      </StatusState>
      <StatusState
        v-else-if="searched && !loading && !shown.length"
        icon="search"
        :title="tab === 'share' ? '没有找到 115 分享' : '没有找到磁力'"
        hint="换个关键词，或在设置里检查 PanSou / Torznab 地址"
      />
      <UiVirtualGrid
        v-if="!error && tab === 'magnet'"
        tag="ul"
        class="netdisk-results"
        :items="magnets"
        :item-key="item => `${item.kind}:${item.hash}`"
      >
        <template #default="{ item }">
          <MagnetResult
            :item="item"
            :adding="offlineAdd.isAdding(item.link)"
            :added="offlineAdd.isAdded(item.link)"
            @copy="actions.copy(item)"
            @offline="offlineAdd.add(item)"
          />
        </template>
      </UiVirtualGrid>
      <UiVirtualGrid
        v-else-if="!error && tab === 'share'"
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
 * 网盘搜索页：关键词 → PanSou（115 分享 + 磁力 / 电驴）与 Torznab（磁力）→ 两组结果，用分段控件切换
 * （虚拟列表，行等高）。115 分享：查看文件是一个玻璃浮层（NetdiskPreview），转存在结果卡片与浮层上；
 * 磁力行显示来源标签、大小、做种与规格，可一键加进 115 离线下载；第三段「离线任务」看经影盒添加的云下载进度
 * （打开页面带 ?tab=offline 直接显示）。一个来源失败时另一个照常出结果，失败说明显示在分段控件旁。
 * 两个来源都没填时引导去设置；需要 115 登录的操作未登录时由主进程返回提示。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { toast } from '@/components/ui/toast'
import { useSetting } from '@/features/settings'
import type { NetdiskItem } from '../../../../../shared/contract/pan115'

import {
  netdisk,
  netdiskAvailable,
  offlineDownloads,
  openNetdiskSettings,
} from '../api'
import NetdiskPreview from '../components/NetdiskPreview.vue'
import MagnetResult from '../components/MagnetResult.vue'
import NetdiskResult from '../components/NetdiskResult.vue'
import OfflineTasks from '../components/OfflineTasks.vue'
import { useOfflineAdd } from '../composables/use-offline'
import { useNetdiskSearch } from '../composables/use-netdisk-search'
import { useShareActions } from '../composables/use-share-actions'

const available = netdiskAvailable
const pansouUrl = useSetting('pan115.pansouUrl')
const { keyword, items, magnets, notes, loading, searched, error, search } =
  useNetdiskSearch(netdisk)
/** 填了 Torznab 地址（读一次；设置里改了回到本页会重新挂载） */
const torznabReady = ref(false)
type Tab = 'share' | 'magnet' | 'offline'
const route = useRoute()
const tab = ref<Tab>(route.query.tab === 'offline' ? 'offline' : 'share')
const count = (n: number): string => (searched.value ? ` ${n}` : '')
const tabs = computed<SegmentedOption<Tab>[]>(() => [
  { value: 'share', label: `115 分享${count(items.value.length)}` },
  { value: 'magnet', label: `磁力${count(magnets.value.length)}` },
  { value: 'offline', label: '离线任务' },
])
const shown = computed(() =>
  tab.value === 'share' ? items.value : magnets.value
)
// 新结果里 115 分享为空、磁力有结果时自动切到磁力；在看离线任务时搜索后回到结果
watch([items, magnets], ([shares, links]) => {
  if (!shares.length && links.length) tab.value = 'magnet'
  else if (shares.length && !links.length) tab.value = 'share'
  else if (tab.value === 'offline') tab.value = 'share'
})
onMounted(async () => {
  if (!available) return
  try {
    torznabReady.value = (await netdisk().torznab()).urls.length > 0
  } catch {
    torznabReady.value = false
  }
})
const actions = useShareActions({
  api: netdisk,
  notify: toast,
  clipboard: () => navigator.clipboard,
})
const preview = actions.preview
const offlineAdd = useOfflineAdd({
  api: offlineDownloads,
  notify: toast,
  openLogin: openNetdiskSettings,
})

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
.netdisk-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}
.netdisk-notes {
  overflow: hidden;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-results {
  margin: 0;
  list-style: none;
  padding-inline: 0;
}
</style>
