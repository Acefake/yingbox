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
          <DialogTitlebar v-if="!embedded" title="数据源" icon="database" @close="emit('close')" />
          <!-- Segmented tabs -->
          <div class="smp-tabs-wrap">
            <div class="yb-seg-group smp-seg">
              <button
                v-for="t in tabs"
                :key="t.id"
                class="yb-seg"
                :class="{ 'is-active': activeTab === t.id }"
                @click="activeTab = t.id"
              >
                {{ t.label }}
                <span class="tab-count">{{ t.count }}</span>
              </button>
            </div>
            <button
              class="yb-btn-soft smp-update-btn"
              :disabled="updatingSources"
              @click="updateSources"
            >
              {{ updatingSources ? '更新中…' : '一键更新' }}
            </button>
            <button
              v-if="totalFail"
              class="yb-btn-soft smp-fail-btn"
              @click="disableAllFailed"
            >
              停用失效源（{{ totalFail }}）
            </button>
            <span v-if="checkingAll" class="smp-status"
              >检测中 {{ checkedCount }}/{{ totalSources }}</span
            >
          </div>

          <div class="smp-body">
            <!-- 在线CMS源 -->
            <template v-if="activeTab === 'online'">
              <div class="section-header">
                <PageTitle as="h2" variant="section">内置 CMS 源</PageTitle>
                <span class="yb-section-count">{{ DEFAULT_SITES.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard
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
              <div class="card-grid">
                <SiteCard
                  v-for="s in visibleCatSpiderSites"
                  :key="s.api"
                  :name="s.name"
                  :api="s.api"
                  badge="插件"
                  badge-color="purple"
                  :enabled="selectedCatSpider.includes(s.api)"
                  status="ok"
                  :checking="false"
                  @toggle="toggleCatSpider(s.api)"
                  @check="() => {}"
                />
              </div>

              <div class="section-header mt">
                <PageTitle as="h2" variant="section">自定义源</PageTitle>
                <button class="add-btn" @click="showAdd = true">+ 添加</button>
              </div>
              <div v-if="customSites.length === 0" class="empty">
                暂无自定义源
              </div>
              <div v-else class="card-grid">
                <SiteCard
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
              <div class="card-grid">
                <SiteCard
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
              <div v-else class="card-grid">
                <SiteCard
                  v-for="s in adultCatSpiderSites"
                  :key="s.api"
                  :name="s.name"
                  :api="s.api"
                  badge="插件"
                  badge-color="purple"
                  :enabled="selectedCatSpider.includes(s.api)"
                  status="ok"
                  :checking="false"
                  @toggle="toggleCatSpider(s.api)"
                  @check="() => {}"
                />
              </div>
            </template>
          </div>
        </div>

        <!-- Add custom source dialog -->
        <div v-if="showAdd" class="add-dialog" @click.self="showAdd = false">
          <div class="add-panel">
            <DialogTitlebar title="添加自定义源" icon="plus" @close="showAdd = false" />
            <p class="hint">
              苹果 CMS v10 接口，例如：https://xxx.com/api.php/provide/vod
            </p>
            <label class="yb-label add-label">名称</label>
            <input v-model="newName" class="yb-field" placeholder="名称" />
            <label class="yb-label add-label">API 地址</label>
            <input
              v-model="newApi"
              class="yb-field"
              placeholder="API 地址"
              @keydown.enter="addCustom"
            />
            <div class="add-actions">
              <button class="yb-btn-soft" @click="showAdd = false">取消</button>
              <button
                class="yb-btn-primary"
                :disabled="addingSource"
                @click="addCustom"
              >
                {{ addingSource ? '分析中…' : '确认添加' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { confirmDialog } from '@/utils/confirm-dialog'
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import PageTitle from '@/components/PageTitle.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
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
const onAdultChange = (e: Event) => {
  adultMode.value = (e as CustomEvent<boolean>).detail
}
const onStorage = (e: StorageEvent) => {
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

const toggleOnline = (api: string) =>
  selectedSites.has(api) ? selectedSites.delete(api) : selectedSites.add(api)
const toggleCatSpider = (api: string) => {
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

const toggleAv = (api: string) =>
  avEnabledApis.has(api) ? avEnabledApis.delete(api) : avEnabledApis.add(api)

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

const disableAllFailed = () => {
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
const activeTab = ref('online')
const tabs = computed(() => [
  {
    id: 'online',
    label: '在线源',
    count: onlineApis.value.length + visibleCatSpiderSites.value.length,
  },
  ...(adultMode.value
    ? [
        {
          id: 'av',
          label: 'AV源',
          count: avSources.value.length + adultCatSpiderSites.value.length,
        },
      ]
    : []),
])

// ── Custom source ────────────────────────────────────────────
const showAdd = ref(false)
const newName = ref('')
const newApi = ref('')
const addingSource = ref(false)

const addCustom = async () => {
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

const removeCustom = (idx: number) => {
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

<script lang="ts">
// SiteCard sub-component defined separately for clarity
import { computed as cc, h as ch, defineComponent as dc } from 'vue'

export const SiteCard = dc({
  name: 'SiteCard',
  props: {
    name: String,
    api: String,
    badge: String,
    badgeColor: { type: String, default: 'blue' },
    enabled: Boolean,
    status: String,
    checking: Boolean,
    deletable: Boolean,
  },
  emits: ['toggle', 'check', 'delete'],
  setup(props, { emit }) {
    const dotClass = cc(() => {
      if (props.status === 'ok') return 'dot ok'
      if (props.status === 'fail') return 'dot fail'
      if (props.status === 'checking') return 'dot checking'
      return 'dot unk'
    })
    const badgeClass = cc(() => `badge badge-${props.badgeColor || 'blue'}`)
    return () =>
      ch(
        'div',
        {
          class: [
            'site-card',
            props.enabled ? 'active' : '',
            props.status === 'fail' ? 'fail' : '',
          ]
            .join(' ')
            .trim(),
          onClick: () => emit('toggle'),
        },
        [
          ch('div', { class: 'card-top' }, [
            ch('span', { class: dotClass.value }),
            ch('span', { class: 'card-name' }, props.name),
            ch('em', { class: badgeClass.value }, props.badge),
            ch(
              'button',
              {
                class: 'icon-btn',
                disabled: props.checking,
                title: '检测数据源',
                'aria-label': `检测数据源 ${props.name}`,
                style: props.checking
                  ? 'animation:spin 1s linear infinite'
                  : '',
                onClick: (e: Event) => {
                  e.stopPropagation()
                  emit('check')
                },
              },
              [
                ch(
                  'svg',
                  {
                    viewBox: '0 0 24 24',
                    width: 11,
                    height: 11,
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': 2,
                  },
                  [
                    ch('path', { d: 'M4 4v5h5M20 20v-5h-5' }),
                    ch('path', { d: 'M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4' }),
                  ]
                ),
              ]
            ),
            props.deletable
              ? ch(
                  'button',
                  {
                    class: 'icon-btn danger',
                    title: '删除数据源',
                    'aria-label': `删除数据源 ${props.name}`,
                    onClick: (e: Event) => {
                      e.stopPropagation()
                      emit('delete')
                    },
                  },
                  [
                    ch(
                      'svg',
                      {
                        viewBox: '0 0 24 24',
                        width: 11,
                        height: 11,
                        fill: 'none',
                        stroke: 'currentColor',
                        'stroke-width': 2,
                      },
                      [
                        ch('polyline', { points: '3 6 5 6 21 6' }),
                        ch('path', {
                          d: 'M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2',
                        }),
                      ]
                    ),
                  ]
                )
              : null,
          ]),
          ch('span', { class: 'card-api' }, props.api),
          props.enabled ? ch('div', { class: 'check-mark' }, '✓') : null,
        ]
      )
  },
})
</script>

<style scoped>
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.smp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.36);
  display: flex;
  justify-content: flex-end;
}

.smp-panel {
  width: min(520px, calc(100vw - 48px));
  height: 100vh;
  background: var(--bg-main);
  border-left: 1px solid var(--separator);
  color: var(--text-primary);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.smp-embedded .smp-tabs-wrap {
  padding: 0 0 12px;
}

.smp-fail-btn {
  min-height: 28px;
  font-size: var(--text-xs);
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.smp-update-btn {
  min-height: 28px;
  font-size: var(--text-xs);
  white-space: nowrap;
}
.smp-update-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.smp-tabs-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 22px 14px;
  flex-shrink: 0;
}
.smp-seg {
  flex: 1;
}
.smp-seg .yb-seg {
  flex: 1;
  min-height: 30px;
  font-size: var(--text-sm);
}
.tab-count {
  margin-left: 4px;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.smp-seg .yb-seg.is-active .tab-count {
  color: var(--accent-text);
}
.smp-status {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.smp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 18px 28px;
}
.smp-body::-webkit-scrollbar {
  width: 6px;
}
.smp-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: var(--radius-xs);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 4px 10px;
}
.section-header.mt {
  margin-top: 22px;
}
.section-header .yb-section-count {
  display: inline;
  font-size: var(--text-xs);
}

.add-btn {
  margin-left: auto;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-fast);
}
.add-btn:hover {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}
.add-btn:active {
  transform: scale(0.97);
}

.empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  padding: 16px 8px;
  text-align: center;
}

.card-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  overflow: hidden;
  box-shadow: none;
}

:deep(.site-card) {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  min-height: 64px;
  padding: 12px 4px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--separator);
  border-radius: 0;
  cursor: pointer;
  transition: background 0.18s var(--ease-out);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
:deep(.site-card:last-child) {
  border-bottom: 0;
}
:deep(.site-card:hover) {
  background: var(--bg-fill-secondary);
}
:deep(.site-card:active) {
  transform: scale(0.995);
}
:deep(.site-card.active) {
  background: var(--bg-active-soft);
}
:deep(.site-card.active .card-name) {
  color: var(--accent-text);
  font-weight: 600;
}
:deep(.site-card.fail .card-name) {
  color: var(--danger);
}
:deep(.card-top) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
:deep(.card-name) {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
:deep(.card-api) {
  display: none;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.site-card:hover .card-api) {
  display: block;
}
:deep(.badge) {
  font-style: normal;
  font-size: var(--text-2xs);
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
:deep(.badge-blue) {
  color: var(--text-primary);
  background: var(--bg-active);
}
:deep(.badge-purple) {
  color: color-mix(in srgb, #af52de 80%, var(--text-primary));
  background: color-mix(in srgb, #af52de 16%, transparent);
}
:deep(.badge-pink) {
  color: color-mix(in srgb, #ff2d55 80%, var(--text-primary));
  background: color-mix(in srgb, #ff2d55 14%, transparent);
}
:deep(.badge-amber) {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
}
:deep(.dot) {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-quaternary);
}
:deep(.dot.ok) {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent);
}
:deep(.dot.fail) {
  background: var(--danger);
}
:deep(.dot.checking) {
  background: var(--warning);
  animation: pulse 1s infinite;
}
:deep(.icon-btn) {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-fast);
  padding: 0;
}
:deep(.icon-btn:hover:not(:disabled)) {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
:deep(.icon-btn:disabled) {
  opacity: 0.35;
  cursor: not-allowed;
}
:deep(.site-card .icon-btn) {
  opacity: 0;
}
:deep(.site-card:hover .icon-btn),
:deep(.site-card:focus-within .icon-btn) {
  opacity: 1;
}
:deep(.icon-btn.danger:hover) {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}
:deep(.check-mark) {
  font-size: var(--text-xs);
  color: var(--accent);
  font-weight: 700;
  pointer-events: none;
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
.add-panel > .dialog-titlebar { margin:-22px -22px 18px; }
.add-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 22px;
  width: min(400px, calc(100vw - 48px));
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}
.hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin: 0 0 14px;
  line-height: 1.4;
}
.add-label {
  display: block;
  margin: 10px 0 6px;
}
.add-panel .yb-field {
  margin-bottom: 2px;
}
.add-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
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

@media (prefers-reduced-transparency: reduce) {
  .smp-panel {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--bg-elevated);
  }
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
  :deep(.site-card:active),
  .add-btn:active {
    transform: none;
  }
}
</style>
