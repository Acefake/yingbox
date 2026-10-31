<template>
  <section class="search-resource-panel" aria-label="影片资源">
    <header class="search-resource-heading">
      <h2>
        {{ work.title }}<span v-if="work.year"> · {{ work.year }}</span>
      </h2>
      <UiIconButton icon="close" label="收起资源" @click="emit('close')" />
    </header>
    <TargetFolderPill
      :folder="target.current.value.folder"
      :active="target.current.value.active"
      :presets="target.presets.value"
      :disabled="!netdiskAvailable"
      @pick="target.pick"
    />
    <p class="search-resource-note">
      在线播放需解析；115 分享和磁力尚未验证，转存或离线下载后才能从片库播放。
    </p>
    <div class="search-resource-scroll">
      <UiVirtualGrid
        :items="ordered"
        :item-key="item => item.key"
        class="search-resource-list"
      >
        <template #default="{ item }">
          <UiMediaRow
            :title="item.title"
            :note="[
              resourceMatch(item, query).possible ? '可能相关' : '符合查询',
              item.sources.join('、'),
              item.reason,
            ]"
            dense
          >
            <template #actions>
              <UiButton
                v-if="item.local"
                size="sm"
                label="播放"
                @click="playLibraryItem(item.local.id)"
              />
              <UiButton
                v-else-if="item.online"
                size="sm"
                label="选择线路"
                @click="emit('online', item)"
              />
              <template v-else-if="item.share">
                <UiButton
                  size="sm"
                  label="查看文件"
                  @click="actions.openPreview(item.share)"
                />
                <UiButton
                  size="sm"
                  :label="actions.isSaved(item.share.url) ? '已转存' : '转存'"
                  :disabled="actions.isSaved(item.share.url)"
                  :loading="actions.isSaving(item.share.url)"
                  @click="actions.save(item.share)"
                />
              </template>
              <UiButton
                v-else-if="item.magnet"
                size="sm"
                :label="
                  offline.isAdded(item.magnet.link) ? '已添加' : '115 离线下载'
                "
                :disabled="offline.isAdded(item.magnet.link)"
                :loading="offline.isAdding(item.magnet.link)"
                @click="offline.add(item.magnet)"
              />
            </template>
          </UiMediaRow>
        </template>
      </UiVirtualGrid>
    </div>
    <NetdiskPreview
      v-if="actions.preview.item.value"
      :item="actions.preview.item.value"
      :snap="actions.preview.snap.value"
      :loading="actions.preview.loading.value"
      :saving="actions.isSaving(actions.preview.item.value.url)"
      :saved="actions.isSaved(actions.preview.item.value.url)"
      @close="actions.closePreview"
      @save="actions.save(actions.preview.item.value)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import {
  UiButton,
  UiIconButton,
  UiMediaRow,
  UiVirtualGrid,
  toast,
} from '@/components/ui'
import { playLibraryItem } from '@/features/library'
import {
  NetdiskPreview,
  TargetFolderPill,
  netdisk,
  netdiskAvailable,
  offlineDownloads,
  openNetdiskSettings,
  useOfflineAdd,
  useShareActions,
  useTargetSettings,
  useTransferTarget,
} from '@/features/netdisk'
import { useSetting } from '@/features/settings'
import { resourceMatch } from './rules'
import type { SearchQuery, SearchResource, SearchWork } from './types'

const props = defineProps<{ work: SearchWork; query: SearchQuery }>()
const ordered = computed(() =>
  [...props.work.resources].sort((a, b) => {
    const first = resourceMatch(a, props.query)
    const second = resourceMatch(b, props.query)
    return (
      Number(first.possible) - Number(second.possible) ||
      second.score - first.score
    )
  })
)
const emit = defineEmits<{ close: []; online: [resource: SearchResource] }>()
const settings = useTargetSettings(useSetting)
const target = useTransferTarget(
  () => (props.work.type === 'series' ? 'tv' : (props.work.type ?? null)),
  () => settings.value
)
const actions = useShareActions({
  api: netdisk,
  notify: toast,
  clipboard: () => navigator.clipboard,
  folder: target.folder,
})
const offline = useOfflineAdd({
  api: offlineDownloads,
  notify: toast,
  openLogin: openNetdiskSettings,
  folder: target.folder,
})
watch(
  () => props.work.key,
  () => {
    target.reset()
    actions.closePreview()
  }
)
</script>

<style scoped>
.search-resource-panel {
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.search-resource-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.search-resource-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.search-resource-note {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: var(--space-3) 0;
}
.search-resource-scroll {
  max-height: 360px;
  overflow-y: auto;
}
.search-resource-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}
</style>
