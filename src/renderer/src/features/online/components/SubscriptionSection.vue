<template>
  <SourceSection
    title="订阅源"
    :count="allSubscribed.length"
    :empty="allSubscribed.length === 0"
    empty-text="还没有订阅源"
    spaced
  >
    <template #action>
      <UiIconButton
        class="section-action"
        icon="refresh"
        size="sm"
        label="立即更新订阅"
        :loading="syncingSubscription"
        @click="update"
      />
    </template>
    <SourceSiteRow
      v-for="s in sortedSites"
      :key="s.api"
      :name="s.name"
      :api="s.api"
      badge="订阅"
      badge-color="pink"
      :enabled="selectedSites.has(s.api)"
      :status="statusOf(s.api)"
      :note="cmsNoteOf(s.api)"
      :checking="checkingSet.has(s.api)"
      @toggle="toggleSite(s.api)"
      @check="checkOnlineSite(s.api)"
    />
  </SourceSection>
  <p class="sub-hint">{{ hint }}</p>
</template>

<script setup lang="ts">
/**
 * 数据源面板里的「订阅源」分组：随包快照加远程内置订阅同步来的 CMS 站点（ADR-0047）。
 * 订阅地址固定；影盒每次启动与「立即更新」时同步。
 */
import { toast } from '@/components/ui'
import { computed } from 'vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import SourceSection from './SourceSection.vue'
import SourceSiteRow from './SourceSiteRow.vue'
import {
  DEFAULT_SITES,
  selectedSites,
  toggleSite,
} from '../composables/cms-sites'
import {
  subscribedSites,
  subscriptionSyncedAt,
  syncSubscription,
  syncingSubscription,
} from '../composables/cms-subscription'
import {
  checkOnlineSite,
  checkingSet,
  cmsNoteOf,
  statusOf,
} from '../composables/use-source-refresh'
import { sortByConnection } from '../utils/source-rules'
import { mergeSites } from '../utils/subscription'

const allSubscribed = computed(() =>
  mergeSites(DEFAULT_SITES, subscribedSites.value)
)
const sortedSites = computed(() =>
  sortByConnection(allSubscribed.value, statusOf)
)
const hint = computed(() =>
  subscriptionSyncedAt.value
    ? `上次同步 ${new Date(subscriptionSyncedAt.value).toLocaleString()}`
    : '启动时自动同步'
)

const update = async (): Promise<void> => {
  try {
    const added = await syncSubscription()
    toast.success(added ? `新增 ${added} 个订阅源` : '订阅已是最新')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '订阅同步失败')
  }
}
</script>

<style scoped>
.sub-hint {
  margin: var(--space-1) var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
