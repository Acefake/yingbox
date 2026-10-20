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
            <!-- 在线CMS源 -->
            <template v-if="activeTab === 'online'">
              <div class="section-header">
                <PageTitle as="h2" variant="section">内置 CMS 源</PageTitle>
                <span class="yb-section-count">{{ DEFAULT_SITES.length }}</span>
              </div>
              <div class="smp-list">
                <SourceSiteRow
                  v-for="s in sortedDefaultSites"
                  :key="s.api"
                  :name="s.name"
                  :api="s.api"
                  badge="CMS"
                  :enabled="selectedSites.has(s.api)"
                  :status="statusOf(s.api)"
                  :checking="checkingSet.has(s.api)"
                  @toggle="toggleOnline(s.api)"
                  @check="checkOnlineSite(s.api)"
                />
              </div>

              <div class="section-header mt">
                <PageTitle as="h2" variant="section">插件视频源</PageTitle>
                <span class="yb-section-count">{{
                  visibleCatSpiderSites.length
                }}</span>
              </div>
              <div v-if="visibleCatSpiderSites.length === 0" class="empty">
                暂无插件源
              </div>
              <div class="smp-list">
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
              </div>

              <div class="section-header mt">
                <PageTitle as="h2" variant="section">自定义源</PageTitle>
                <UiIconButton
                  class="section-action"
                  icon="plus"
                  size="sm"
                  label="添加自定义源"
                  @click="showAdd = true"
                />
              </div>
              <div v-if="customSites.length === 0" class="empty">
                暂无自定义源
              </div>
              <div v-else class="smp-list">
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
                  @toggle="toggleOnline(s.api)"
                  @check="checkOnlineSite(s.api)"
                  @delete="removeCustom(i)"
                />
              </div>
            </template>

            <!-- AV源 -->
            <template v-if="activeTab === 'av'">
              <div class="section-header">
                <PageTitle as="h2" variant="section">AV 资源站点</PageTitle>
                <span class="yb-section-count">{{ avSources.length }}</span>
              </div>
              <div class="smp-list">
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
              </div>

              <div class="section-header mt">
                <PageTitle as="h2" variant="section">AV 插件源</PageTitle>
                <span class="yb-section-count">{{
                  adultCatSpiderSites.length
                }}</span>
              </div>
              <div v-if="adultCatSpiderSites.length === 0" class="empty">
                暂无插件源
              </div>
              <div v-else class="smp-list">
                <SourceSiteRow
                  v-for="s in adultCatSpiderSites"
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
              </div>
            </template>
          </div>
        </div>

        <!-- Add custom source dialog -->
        <div v-if="showAdd" class="add-dialog" @click.self="showAdd = false">
          <div class="add-panel">
            <DialogTitlebar
              title="添加自定义源"
              icon="plus"
              @close="showAdd = false"
            />
            <div class="add-body">
              <p class="hint">
                苹果 CMS v10 接口，例如：https://xxx.com/api.php/provide/vod
              </p>
              <label class="yb-label add-label">名称</label>
              <UiInput v-model="newName" placeholder="名称" />
              <label class="yb-label add-label">API 地址</label>
              <UiInput
                v-model="newApi"
                placeholder="API 地址"
                @keydown.enter="addCustom"
              />
              <div class="add-actions">
                <UiButton label="取消" @click="showAdd = false" />
                <UiButton
                  variant="primary"
                  :label="addingSource ? '分析中…' : '确认添加'"
                  :loading="addingSource"
                  @click="addCustom"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 数据源管理：在线 CMS / 插件 / 自定义源，以及成人模式下的 AV 源。
 * 既能作为独立侧滑面板，也能 embedded 嵌入设置窗口的「数据源」分区。
 */
import { message } from 'ant-design-vue'
import { computed, onUnmounted, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import PageTitle from '@/components/PageTitle.vue'
import SourceSiteRow from '@/components/settings/SourceSiteRow.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { confirmDialog } from '@/utils/confirm-dialog'
import { useOnlineSearch } from '@/views/online/composables/use-online-search'
import { useAvSources } from '@/views/av/use-av-sources'
import {
  type SiteStatus,
  avCheckingSet,
  avStatusMap,
  avStatusOf,
  checkAll,
  checkAvSite,
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
} from '@/composables/use-source-refresh'

const props = defineProps<{ visible: boolean; embedded?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// ── Adult mode ───────────────────────────────────────────────
const adultMode = ref(localStorage.getItem('adultMode') === '1')
const onAdultChange = (e: Event): void => {
  adultMode.value = (e as CustomEvent<boolean>).detail
}
const onStorage = (e: StorageEvent): void => {
  if (e.key === 'adultMode') adultMode.value = e.newValue === '1'
}
window.addEventListener('adultModeChange', onAdultChange)
window.addEventListener('storage', onStorage)
onUnmounted(() => {
  window.removeEventListener('adultModeChange', onAdultChange)
  window.removeEventListener('storage', onStorage)
})

// ── Online sources ───────────────────────────────────────────
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

const connectionRank = (status: SiteStatus): number =>
  status === 'ok' ? 0 : status === 'checking' ? 1 : status === 'unknown' ? 2 : 3
const sortedDefaultSites = computed(() =>
  [...DEFAULT_SITES].sort(
    (a, b) => connectionRank(statusOf(a.api)) - connectionRank(statusOf(b.api))
  )
)
const sortedCustomSites = computed(() =>
  [...customSites.value].sort(
    (a, b) => connectionRank(statusOf(a.api)) - connectionRank(statusOf(b.api))
  )
)

const toggleOnline = (api: string): void => {
  if (selectedSites.has(api)) selectedSites.delete(api)
  else selectedSites.add(api)
}
const toggleCatSpider = (api: string): void => {
  const idx = selectedCatSpider.value.indexOf(api)
  if (idx >= 0) selectedCatSpider.value.splice(idx, 1)
  else selectedCatSpider.value.push(api)
}

// ── AV sources ───────────────────────────────────────────────
const {
  enabledApis: avEnabledApis,
  allSources: avSources,
  addSources: addAvSources,
} = useAvSources()

const sortedAvSources = computed(() =>
  [...avSources.value].sort(
    (a, b) =>
      connectionRank(avStatusOf(a.api)) - connectionRank(avStatusOf(b.api))
  )
)

const toggleAv = (api: string): void => {
  if (avEnabledApis.has(api)) avEnabledApis.delete(api)
  else avEnabledApis.add(api)
}

// ── All-source stats ─────────────────────────────────────────
const totalSources = computed(
  () => onlineApis.value.length + (adultMode.value ? avSources.value.length : 0)
)

const totalFail = computed(
  () =>
    onlineApis.value.filter(a => statusMap[a] === 'fail').length +
    (adultMode.value
      ? avSources.value.filter(s => avStatusMap[s.api] === 'fail').length
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
  confirmDialog({
    title: `禁用 ${totalFail.value} 个失效数据源？`,
    content: '只会停用这些数据源，不会删除自定义配置。',
    okText: '禁用',
    cancelText: '取消',
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

// ── Tabs ────────────────────────────────────────────────────
type SourceTab = 'online' | 'av'
const activeTab = ref<SourceTab>('online')
const tabs = computed<SegmentedOption<SourceTab>[]>(() => [
  {
    value: 'online',
    label: `在线源 ${onlineApis.value.length + visibleCatSpiderSites.value.length}`,
  },
  ...(adultMode.value
    ? [
        {
          value: 'av' as const,
          label: `AV 源 ${avSources.value.length + adultCatSpiderSites.value.length}`,
        },
      ]
    : []),
])
// 关闭成人模式后不要停留在已经消失的 AV 分类
watch(adultMode, on => {
  if (!on) activeTab.value = 'online'
})

// ── Custom source ────────────────────────────────────────────
const showAdd = ref(false)
const newName = ref('')
const newApi = ref('')
const addingSource = ref(false)

const addCustom = async (): Promise<void> => {
  if (addingSource.value) return
  const name = newName.value.trim()
  const api = newApi.value.trim()
  if (!name || !api) {
    message.warning('请填写数据源名称和 API 地址')
    return
  }
  try {
    const parsed = new URL(api)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    message.error('请输入有效的 HTTP 或 HTTPS API 地址')
    return
  }
  if (
    customSites.value.some(site => site.api === api) ||
    avSources.value.some(site => site.api === api)
  ) {
    message.info('这个数据源已经添加')
    return
  }
  addingSource.value = true
  try {
    const added = addAvSources([{ name, api }])
    if (!added) throw new Error('这个数据源已经添加')
    message.success('已加入 AV 源')
    await checkAvSite(api)
    showAdd.value = false
    newName.value = ''
    newApi.value = ''
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '数据源分析失败，请检查接口地址'
    )
  } finally {
    addingSource.value = false
  }
}

const removeCustom = (idx: number): void => {
  const site = customSites.value[idx]
  confirmDialog({
    title: `删除数据源“${site.name}”？`,
    content: '删除后需要重新填写地址才能恢复。',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
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
  z-index: 2000;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.36);
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

.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-2);
}
.section-header.mt {
  margin-top: var(--space-6);
}
.section-header .yb-section-count {
  display: inline;
  font-size: var(--text-xs);
}
.section-action {
  margin-left: auto;
}

/* 内嵌分组：和设置里的 SettingsGroup 同一种底板 */
.smp-list {
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-glass);
}
.smp-list:empty {
  display: none;
}

.empty {
  padding: var(--space-4) var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}

.add-dialog {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}
.add-panel {
  width: min(400px, calc(100vw - 48px));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}
.add-body {
  padding: var(--space-5);
}
.hint {
  margin: 0 0 var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
.add-label {
  display: block;
  margin: var(--space-3) 0 var(--space-1);
}
.add-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.3s var(--ease-out);
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
    transition: opacity 0.2s ease;
  }
  .panel-fade-enter-from .smp-panel,
  .panel-fade-leave-to .smp-panel {
    transform: none;
  }
}
</style>
