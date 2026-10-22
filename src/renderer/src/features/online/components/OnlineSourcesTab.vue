<template>
  <SourceSection title="内置 CMS 源" :count="DEFAULT_SITES.length">
    <SourceSiteRow
      v-for="s in sortedDefaultSites"
      :key="s.api"
      :name="s.name"
      :api="s.api"
      badge="CMS"
      :enabled="selectedSites.has(s.api)"
      :status="statusOf(s.api)"
      :checking="checkingSet.has(s.api)"
      @toggle="toggleSite(s.api)"
      @check="checkOnlineSite(s.api)"
    />
  </SourceSection>

  <SourceSection
    title="插件视频源"
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
      v-bind="pluginRowProps(s.name)"
      @toggle="toggleCatSpider(s.api)"
      @check="retryPlugin(s.name)"
    />
  </SourceSection>

  <SourceSection
    title="自定义源"
    :empty="customSites.length === 0"
    empty-text="暂无自定义源"
    spaced
  >
    <template #action>
      <UiIconButton
        class="section-action"
        icon="plus"
        size="sm"
        label="添加自定义源"
        @click="emit('add')"
      />
    </template>
    <SourceSiteRow
      v-for="s in sortedCustomSites"
      :key="s.api"
      :name="s.name"
      :api="s.api"
      badge="自定义"
      badge-color="amber"
      :enabled="selectedSites.has(s.api)"
      :status="statusOf(s.api)"
      :checking="checkingSet.has(s.api)"
      deletable
      @toggle="toggleSite(s.api)"
      @check="checkOnlineSite(s.api)"
      @delete="removeCustom(s.api)"
    />
  </SourceSection>
</template>

<script setup lang="ts">
/**
 * 数据源面板的「在线源」分类：内置 CMS 源、插件视频源（不含成人插件）、自定义源。
 * 「添加自定义源」只发 add 事件，对话框由面板持有（切换分类时保留已填内容）。
 */
import { computed } from 'vue'
import { confirmDialog } from '@/components/ui'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { CatSpiderSite } from '../types'
import { toggleCatSpider } from '../composables/catspider-sites'
import { toggleSite } from '../composables/cms-sites'
import { pluginRowProps, retryPlugin } from '../composables/plugin-health'
import { useOnlineSearch } from '../composables/use-online-search'
import {
  checkOnlineSite,
  checkingSet,
  statusMap,
  statusOf,
} from '../composables/use-source-refresh'
import { sortByConnection } from '../utils/source-rules'
import SourceSection from './SourceSection.vue'
import SourceSiteRow from './SourceSiteRow.vue'

defineProps<{ plugins: CatSpiderSite[] }>()
const emit = defineEmits<{ (e: 'add'): void }>()

const { selectedSites, customSites, DEFAULT_SITES, selectedCatSpider } =
  useOnlineSearch()
const sortedDefaultSites = computed(() =>
  sortByConnection(DEFAULT_SITES, statusOf)
)
const sortedCustomSites = computed(() =>
  sortByConnection(customSites.value, statusOf)
)

/**
 * 删除一个自定义源。按 api 认源（添加时已保证不重复）：列表是排序后显示的，
 * 不能拿显示位置去删存储数组。
 */
const removeCustom = (api: string): void => {
  const site = customSites.value.find(s => s.api === api)
  if (!site) return
  void confirmDialog({
    title: `删除数据源“${site.name}”？`,
    content: '删除后需要重新填写地址才能恢复。',
    okText: '删除',
    danger: true,
    onOk: () => {
      selectedSites.delete(site.api)
      delete statusMap[site.api]
      customSites.value = customSites.value.filter(s => s.api !== api)
    },
  })
}
</script>

<style scoped>
.section-action {
  margin-left: auto;
}
</style>
