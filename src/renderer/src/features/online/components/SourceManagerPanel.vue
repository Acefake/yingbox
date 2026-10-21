<template>
  <Teleport to="body" :disabled="embedded">
    <Transition name="panel-fade" :css="!embedded">
      <div
        v-if="visible"
        :class="embedded ? 'smp-embedded' : 'smp-backdrop'"
        @click.self="!embedded && emit('close')"
      >
        <div :class="embedded ? 'smp-embedded-panel' : 'smp-panel'">
          <!-- Header（仅独立面板） -->
          <DialogTitlebar
            v-if="!embedded"
            title="数据源"
            icon="database"
            @close="emit('close')"
          />
          <div class="smp-toolbar">
            <UiSegmented
              v-if="tabs.length > 1"
              v-model="activeTab"
              size="sm"
              label="数据源分类"
              :options="tabs"
            />
            <span v-if="checkingAll" class="smp-status" role="status">
              检测中 {{ checkedCount }}/{{ totalSources }}
            </span>
            <div class="smp-toolbar-actions">
              <UiButton
                v-if="totalFail"
                class="smp-fail-btn"
                size="sm"
                :label="`停用失效源（${totalFail}）`"
                @click="disableAllFailed"
              />
              <UiIconButton
                icon="refresh"
                label="一键更新：同步并检测全部数据源"
                :loading="updatingSources"
                @click="updateSources"
              />
            </div>
          </div>

          <div class="smp-body">
            <!-- 在线 CMS / 插件 / 自定义源 -->
            <template v-if="activeTab === 'online'">
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
                :count="visibleCatSpiderSites.length"
                :empty="visibleCatSpiderSites.length === 0"
                empty-text="暂无插件源"
                spaced
              >
                <SourceSiteRow
                  v-for="s in visibleCatSpiderSites"
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
                    @click="showAdd = true"
                  />
                </template>
                <SourceSiteRow
                  v-for="(s, i) in sortedCustomSites"
                  :key="s.api + i"
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
                  @delete="removeCustom(i)"
                />
              </SourceSection>
            </template>

            <!-- AV 源 -->
            <AvSourcesTab
              v-if="activeTab === 'av'"
              :plugins="adultCatSpiderSites"
            />
          </div>
        </div>

        <!-- 添加自定义源（v-show：取消后再打开时保留已填内容） -->
        <AddSourceDialog v-show="showAdd" @close="showAdd = false" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 数据源管理：在线 CMS / 插件 / 自定义源，以及成人模式下的 AV 源。
 * 既能作为独立侧滑面板，也能 embedded 嵌入设置窗口的「数据源」分区。
 * AV 分类、分组外框、添加对话框分别是 AvSourcesTab / SourceSection / AddSourceDialog。
 */
import { confirmDialog } from '@/components/ui'
import { computed, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import AddSourceDialog from './AddSourceDialog.vue'
import AvSourcesTab from './AvSourcesTab.vue'
import SourceSection from './SourceSection.vue'
import SourceSiteRow from './SourceSiteRow.vue'
import { useSetting } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { useOnlineSearch } from '../composables/use-online-search'
import { toggleCatSpider } from '../composables/catspider-sites'
import { toggleSite } from '../composables/cms-sites'
import { useAvSources } from '@/features/av'
import {
  avStatusMap,
  checkAll,
  checkOnlineSite,
  checkedCount,
  checkingAll,
  checkingSet,
  onlineApis,
  refreshSources,
  statusMap,
  statusOf,
  syncAvSources,
  syncingAv,
} from '../composables/use-source-refresh'
import {
  type SourceTab,
  countFailed,
  sortByConnection,
  sourceTabs,
} from '../utils/source-rules'

const props = defineProps<{ visible: boolean; embedded?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const adultMode = useSetting('app.adultMode')

// ── 在线源 ───────────────────────────────────────────────────
const {
  selectedSites,
  customSites,
  DEFAULT_SITES,
  CATSPIDER_SITES,
  selectedCatSpider,
  isAdultCatSpiderSite,
} = useOnlineSearch()
// 成人插件源统一归入 AV 源标签，不再出现在在线源的插件列表中。
const adultCatSpiderSites = computed(() =>
  CATSPIDER_SITES.value.filter(site => isAdultCatSpiderSite(site))
)
const visibleCatSpiderSites = computed(() =>
  CATSPIDER_SITES.value.filter(site => !isAdultCatSpiderSite(site))
)
const sortedDefaultSites = computed(() =>
  sortByConnection(DEFAULT_SITES, statusOf)
)
const sortedCustomSites = computed(() =>
  sortByConnection(customSites.value, statusOf)
)

// ── 全部源统计（AV 源只在成人模式下计入） ──────────────────────
const { enabledApis: avEnabledApis, allSources: avSources } = useAvSources()
const totalSources = computed(
  () => onlineApis.value.length + (adultMode.value ? avSources.value.length : 0)
)
const totalFail = computed(
  () =>
    countFailed(onlineApis.value, statusMap) +
    (adultMode.value
      ? countFailed(
          avSources.value.map(s => s.api),
          avStatusMap
        )
      : 0)
)

/** 一键更新：拉取远程源清单合并新源，再重新检测全部源（自动启用可用源、停用失效源）。 */
const updatingSources = computed(() => syncingAv.value || checkingAll.value)
const updateSources = async (): Promise<void> => {
  if (updatingSources.value) return
  await syncAvSources(true)
  await checkAll()
}

const disableAllFailed = (): void => {
  void confirmDialog({
    title: `禁用 ${totalFail.value} 个失效数据源？`,
    content: '只会停用这些数据源，不会删除自定义配置。',
    okText: '禁用',
    onOk: () => {
      for (const a of onlineApis.value) {
        if (statusMap[a] === 'fail') selectedSites.delete(a)
      }
      for (const s of avSources.value) {
        if (avStatusMap[s.api] === 'fail') avEnabledApis.delete(s.api)
      }
    },
  })
}

// ── 启动与打开面板时自动同步并检测 ───────────────────────────
watch(
  () => props.visible,
  visible => {
    if (visible) void refreshSources()
  }
)

// ── 分类 ────────────────────────────────────────────────────
const activeTab = ref<SourceTab>('online')
const tabs = computed(() =>
  sourceTabs(
    onlineApis.value.length + visibleCatSpiderSites.value.length,
    adultMode.value
      ? avSources.value.length + adultCatSpiderSites.value.length
      : null
  )
)
// 关闭成人模式后不要停留在已经消失的 AV 分类
watch(adultMode, on => {
  if (!on) activeTab.value = 'online'
})

// ── 自定义源 ─────────────────────────────────────────────────
const showAdd = ref(false)
const removeCustom = (idx: number): void => {
  const site = customSites.value[idx]
  void confirmDialog({
    title: `删除数据源“${site.name}”？`,
    content: '删除后需要重新填写地址才能恢复。',
    okText: '删除',
    danger: true,
    onOk: () => {
      selectedSites.delete(site.api)
      delete statusMap[site.api]
      customSites.value = customSites.value.filter((_, i) => i !== idx)
    },
  })
}
</script>

<style scoped>
.smp-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: var(--overlay-scrim-soft);
}

.smp-panel {
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 48px));
  height: 100vh;
  overflow: hidden;
  border-left: 1px solid var(--separator);
  background: var(--bg-main);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  transition: var(--transition-panel);
}

/* 嵌入模式：在统一设置窗口内渲染，不带遮罩与标题 */
.smp-embedded {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text-primary);
}
.smp-embedded-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.smp-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
}
.smp-embedded .smp-toolbar {
  padding: 0 0 var(--space-4);
}
.smp-toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.smp-status {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.smp-fail-btn {
  color: var(--danger);
}

.smp-body {
  flex: 1;
  padding: 0 var(--space-5) var(--space-7);
  overflow-y: auto;
}
.smp-embedded .smp-body {
  padding: 0 var(--space-2) var(--space-6) 0;
}

.section-action {
  margin-left: auto;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity var(--duration-slow) var(--ease-out);
}
.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
.panel-fade-enter-active .smp-panel,
.panel-fade-leave-active .smp-panel {
  transition: var(--transition-panel);
}
.panel-fade-enter-from .smp-panel,
.panel-fade-leave-to .smp-panel {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .panel-fade-enter-active,
  .panel-fade-leave-active,
  .panel-fade-enter-active .smp-panel,
  .panel-fade-leave-active .smp-panel {
    transition: opacity var(--duration-normal) ease;
  }
  .panel-fade-enter-from .smp-panel,
  .panel-fade-leave-to .smp-panel {
    transform: none;
  }
}
</style>
