<template>
  <SourceSection title="AV 资源站点" :count="avSources.length">
    <SourceSiteRow
      v-for="s in sortedAvSources"
      :key="s.api"
      :name="s.name"
      :api="s.api"
      badge="AV"
      badge-color="pink"
      :enabled="avEnabledApis.has(s.api)"
      :status="avStatusOf(s.api)"
      :checking="avCheckingSet.has(s.api)"
      @toggle="toggleAv(s.api)"
      @check="checkAvSite(s.api)"
    />
  </SourceSection>

  <SourceSection
    title="AV 插件源"
    :count="plugins.length"
    :empty="plugins.length === 0"
    empty-text="暂无插件源"
    spaced
  >
    <SourceSiteRow
      v-for="s in plugins"
      :key="s.api"
      :name="s.name"
      :api="s.api"
      badge="插件"
      badge-color="purple"
      :enabled="selectedCatSpider.includes(s.api)"
      status="ok"
      :checkable="false"
      @toggle="toggleCatSpider(s.api)"
    />
  </SourceSection>
</template>

<script setup lang="ts">
/**
 * 数据源面板的「AV 源」分类：AV CMS 站点（可检测、按连通状态排序）与成人插件源。
 * 只在成人模式下出现。
 */
import { computed } from 'vue'
import { useAvSources } from '@/features/av'
import type { CatSpiderSite } from '../types'
import {
  selectedCatSpider,
  toggleCatSpider,
} from '../composables/catspider-sites'
import {
  avCheckingSet,
  avStatusOf,
  checkAvSite,
} from '../composables/use-source-refresh'
import { sortByConnection } from '../utils/source-rules'
import SourceSection from './SourceSection.vue'
import SourceSiteRow from './SourceSiteRow.vue'

defineProps<{ plugins: CatSpiderSite[] }>()

const { enabledApis: avEnabledApis, allSources: avSources } = useAvSources()
const sortedAvSources = computed(() =>
  sortByConnection(avSources.value, avStatusOf)
)
const toggleAv = (api: string): void => {
  if (avEnabledApis.has(api)) avEnabledApis.delete(api)
  else avEnabledApis.add(api)
}
</script>
