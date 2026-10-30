<template>
  <SourceSection
    title="订阅源"
    :count="subscribedSites.length"
    :empty="subscribedSites.length === 0"
    :empty-text="emptyText"
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
  <div class="sub-url">
    <UiInput
      v-model="draftUrl"
      v-enter="save"
      size="sm"
      icon="link"
      placeholder="订阅地址，留空关闭"
      @blur="save"
    />
    <p class="sub-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 数据源面板里的「订阅源」分组：远程清单同步来的 CMS 站点，以及订阅地址设置。
 * 默认订阅上游每小时测活，影盒每次启动与「一键更新」时同步。
 */
import { toast } from '@/components/ui'
import { computed, ref } from 'vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { vEnter } from '@/directives/enter'
import SourceSection from './SourceSection.vue'
import SourceSiteRow from './SourceSiteRow.vue'
import { selectedSites, toggleSite } from '../composables/cms-sites'
import {
  subscribedSites,
  subscriptionSyncedAt,
  subscriptionUrl,
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

const draftUrl = ref(subscriptionUrl.value)

const sortedSites = computed(() =>
  sortByConnection(subscribedSites.value, statusOf)
)
const emptyText = computed(() =>
  subscriptionUrl.value ? '还没有同步到订阅源' : '未开启订阅'
)
const hint = computed(() => {
  if (!subscriptionUrl.value)
    return '填入 LunaTV / MoonTV 格式的配置地址即可开启'
  if (!subscriptionSyncedAt.value) return '启动时自动同步'
  return `上次同步 ${new Date(subscriptionSyncedAt.value).toLocaleString()}`
})

const update = async (): Promise<void> => {
  try {
    const added = await syncSubscription()
    toast.success(added ? `新增 ${added} 个订阅源` : '订阅已是最新')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '订阅同步失败')
  }
}

const save = (): void => {
  const url = draftUrl.value.trim()
  if (url === subscriptionUrl.value) return
  if (url && !/^https?:\/\//i.test(url)) {
    toast.error('订阅地址需要以 http:// 或 https:// 开头')
    return
  }
  subscriptionUrl.value = url
  void update()
}
</script>

<style scoped>
.sub-url {
  margin: var(--space-2) var(--space-4) 0;
}
.sub-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
