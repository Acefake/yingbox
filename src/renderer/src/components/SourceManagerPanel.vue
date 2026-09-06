<template>
  <Teleport to="body">
    <Transition name="panel-fade">
      <div v-if="visible" class="smp-backdrop" @click.self="emit('close')">
        <div class="smp-panel">
          <!-- Header -->
          <div class="smp-header">
            <div class="smp-heading">
              <h1 class="yb-page-title smp-title">数据源</h1>
              <p class="yb-section-subtitle smp-subtitle">{{ sourceActivityText }}</p>
            </div>
            <div class="smp-header-actions">
              <button
                v-if="totalFail"
                class="yb-btn-soft smp-fail-btn"
                @click="disableAllFailed"
              >
                停用失效源（{{ totalFail }}）
              </button>
              <button class="smp-close" aria-label="关闭数据源管理" @click="emit('close')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </div>

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
            <span v-if="checkingAll" class="smp-status">检测中 {{ checkedCount }}/{{ totalSources }}</span>
          </div>

          <div class="smp-body">
            <!-- 在线CMS源 -->
            <template v-if="activeTab === 'online'">
              <div class="section-header">
                <h2 class="yb-section-title">内置 CMS 源</h2>
                <span class="yb-section-count">{{ DEFAULT_SITES.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in sortedDefaultSites" :key="s.api" :name="s.name" :api="s.api" badge="CMS"
                  :enabled="selectedSites.has(s.api)" :status="statusOf(s.api)" :checking="checkingSet.has(s.api)"
                  @toggle="toggleOnline(s.api)" @check="checkOnlineSite(s.api)" />
              </div>

              <div class="section-header mt">
                <h2 class="yb-section-title">插件视频源</h2>
                <span class="yb-section-count">{{ visibleCatSpiderSites.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in visibleCatSpiderSites" :key="s.api" :name="s.name" :api="s.api" badge="插件"
                  badge-color="purple" :enabled="selectedCatSpider.includes(s.api)" status="ok" :checking="false"
                  @toggle="toggleCatSpider(s.api)" @check="() => {}" />
              </div>

              <div class="section-header mt">
                <h2 class="yb-section-title">自定义源</h2>
                <button class="add-btn" @click="showAdd = true">+ 添加</button>
              </div>
              <div v-if="customSites.length === 0" class="empty">暂无自定义源</div>
              <div v-else class="card-grid">
                <SiteCard v-for="(s, i) in sortedCustomSites" :key="s.api + i" :name="s.name" :api="s.api" badge="自定义"
                  badge-color="amber" :enabled="selectedSites.has(s.api)" :status="statusOf(s.api)"
                  :checking="checkingSet.has(s.api)" deletable @toggle="toggleOnline(s.api)"
                  @check="checkOnlineSite(s.api)" @delete="removeCustom(i)" />
              </div>
            </template>

            <!-- AV源 -->
            <template v-if="activeTab === 'av'">
              <div class="section-header">
                <h2 class="yb-section-title">AV 资源站点</h2>
                <span class="yb-section-count">{{ avSources.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in sortedAvSources" :key="s.api" :name="s.name" :api="s.api" badge="AV"
                  badge-color="pink" :enabled="avEnabledApis.has(s.api)" :status="avStatusOf(s.api)"
                  :checking="avCheckingSet.has(s.api)" @toggle="toggleAv(s.api)" @check="checkAvSite(s.api)" />
              </div>
            </template>
          </div>
        </div>

        <!-- Add custom source dialog -->
        <div v-if="showAdd" class="add-dialog" @click.self="showAdd = false">
          <div class="add-panel">
            <h3 class="yb-section-title">添加自定义源</h3>
            <p class="hint">苹果 CMS v10 接口，例如：https://xxx.com/api.php/provide/vod</p>
            <label class="yb-label add-label">名称</label>
            <input v-model="newName" class="yb-field" placeholder="名称" />
            <label class="yb-label add-label">API 地址</label>
            <input v-model="newApi" class="yb-field" placeholder="API 地址" @keydown.enter="addCustom" />
            <div class="add-actions">
              <button class="yb-btn-soft" @click="showAdd = false">取消</button>
              <button class="yb-btn-primary" :disabled="addingSource" @click="addCustom">{{ addingSource ? '分析中…' : '确认添加' }}</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onUnmounted, watch } from 'vue'
import axios from 'axios'
import { Modal, message } from 'ant-design-vue'
import { useOnlineSearch } from '@/views/online/composables/use-online-search'
import { useAvSources } from '@/views/av/use-av-sources'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// ── Adult mode ───────────────────────────────────────────────
const adultMode = ref(localStorage.getItem('adultMode') === '1')
const onAdultChange = (e: Event) => { adultMode.value = (e as CustomEvent<boolean>).detail }
const onStorage = (e: StorageEvent) => { if (e.key === 'adultMode') adultMode.value = e.newValue === '1' }
window.addEventListener('adultModeChange', onAdultChange)
window.addEventListener('storage', onStorage)
onUnmounted(() => {
  window.removeEventListener('adultModeChange', onAdultChange)
  window.removeEventListener('storage', onStorage)
})

// ── Online sources ───────────────────────────────────────────
const { selectedSites, customSites, DEFAULT_SITES, CATSPIDER_SITES, selectedCatSpider, loadCatSpiderSites, isAdultCatSpiderSite } = useOnlineSearch()
const visibleCatSpiderSites = computed(() =>
  CATSPIDER_SITES.value.filter(site => adultMode.value || !isAdultCatSpiderSite(site))
)

type SiteStatus = 'unknown' | 'checking' | 'ok' | 'fail'
const statusMap = reactive<Record<string, SiteStatus>>({})
const checkingSet = reactive<Set<string>>(new Set())

const statusOf = (api: string): SiteStatus => statusMap[api] ?? 'unknown'
const connectionRank = (status: SiteStatus): number => status === 'ok' ? 0 : status === 'checking' ? 1 : status === 'unknown' ? 2 : 3
const sortedDefaultSites = computed(() => [...DEFAULT_SITES].sort((a, b) => connectionRank(statusOf(a.api)) - connectionRank(statusOf(b.api))))
const sortedCustomSites = computed(() => [...customSites.value].sort((a, b) => connectionRank(statusOf(a.api)) - connectionRank(statusOf(b.api))))

const checkOnlineSite = async (api: string, autoEnable = false) => {
  if (checkingSet.has(api)) return
  checkingSet.add(api)
  statusMap[api] = 'checking'
  try {
    const res = await axios.get(`${api}?ac=videolist&wd=test`, { timeout: 8000 })
    const ok = res.data?.list !== undefined
    statusMap[api] = ok ? 'ok' : 'fail'
    if (ok && autoEnable) selectedSites.add(api)
    if (!ok && autoEnable) selectedSites.delete(api)
  } catch {
    statusMap[api] = 'fail'
    if (autoEnable) selectedSites.delete(api)
  } finally {
    checkingSet.delete(api)
  }
}

const toggleOnline = (api: string) => selectedSites.has(api) ? selectedSites.delete(api) : selectedSites.add(api)
const toggleCatSpider = (api: string) => {
  const idx = selectedCatSpider.value.indexOf(api)
  if (idx >= 0) selectedCatSpider.value.splice(idx, 1)
  else selectedCatSpider.value.push(api)
}

// ── AV sources ───────────────────────────────────────────────
const { enabledApis: avEnabledApis, allSources: avSources, addSources: addAvSources } = useAvSources()
const syncingAv = ref(false)
const ORDINARY_CMS_NAMES = /^(?:无尽|豪华|红牛|极速|虎牙|速播|樱花|光速)资源站?$/
const syncAvSources = async (showMessage = true) => {
  syncingAv.value = true
  try {
    const response = await axios.get('https://mylazily.github.io/ziyuanzhan/data/online.json', { timeout: 15000 })
    const entries = Array.isArray(response.data?.data) ? response.data.data : []
    const sources = entries.map((entry: any) => {
      const name = String(entry.name || entry.title || '在线资源站').trim()
      const api = String(entry.api || entry.url || entry.link || '').trim()
      return { name, api }
    }).filter((source: { name: string; api: string }) =>
      /^https?:\/\//i.test(source.api) && /(?:api\.php\/provide\/vod|api\/json\.php)/i.test(source.api))
    // 远程清单混合了普通 CMS 与 AV 源；先按站点名称分流，避免普通源落入 AV 标签。
    const ordinaryCmsSources = sources.filter(source => ORDINARY_CMS_NAMES.test(source.name))
    const avOnlySources = sources.filter(source => !ORDINARY_CMS_NAMES.test(source.name))
    const knownCmsApis = new Set(DEFAULT_SITES.map(site => site.api))
    let addedCms = 0
    for (const source of ordinaryCmsSources) {
      if (knownCmsApis.has(source.api) || customSites.value.some(site => site.api === source.api)) continue
      customSites.value = [...customSites.value, source]
      selectedSites.add(source.api)
      addedCms++
    }
    const added = addAvSources(avOnlySources)
    const sourceApis = new Set(avOnlySources.map(source => source.api))
    const movedOnlineSources = customSites.value.filter(source => sourceApis.has(source.api))
    movedOnlineSources.forEach(source => selectedSites.delete(source.api))
    if (movedOnlineSources.length) {
      customSites.value = customSites.value.filter(source => !sourceApis.has(source.api))
    }
    if (showMessage) message.success(added + addedCms ? `已同步 ${added + addedCms} 个新数据源` : '没有发现新的兼容数据源')
  } catch (error) {
    if (showMessage) message.error(error instanceof Error ? error.message : '在线数据源同步失败')
  } finally {
    syncingAv.value = false
  }
}
const avStatusMap = reactive<Record<string, SiteStatus>>({})
const avCheckingSet = reactive<Set<string>>(new Set())

const avStatusOf = (api: string): SiteStatus => avStatusMap[api] ?? 'unknown'
const sortedAvSources = computed(() => [...avSources.value].sort((a, b) => connectionRank(avStatusOf(a.api)) - connectionRank(avStatusOf(b.api))))

const checkAvSite = async (api: string, autoEnable = false) => {
  if (avCheckingSet.has(api)) return
  avCheckingSet.add(api)
  avStatusMap[api] = 'checking'
  try {
    const res = await axios.get(`${api}?ac=detail`, { timeout: 8000 })
    const ok = res.data?.list !== undefined
    avStatusMap[api] = ok ? 'ok' : 'fail'
    if (ok && autoEnable) avEnabledApis.add(api)
    if (!ok && autoEnable) avEnabledApis.delete(api)
  } catch {
    avStatusMap[api] = 'fail'
    if (autoEnable) avEnabledApis.delete(api)
  } finally {
    avCheckingSet.delete(api)
  }
}

const toggleAv = (api: string) => avEnabledApis.has(api) ? avEnabledApis.delete(api) : avEnabledApis.add(api)

// ── All-source stats ─────────────────────────────────────────
const onlineApis = computed(() => [
  ...DEFAULT_SITES.map(s => s.api),
  ...customSites.value.map(s => s.api),
])
const totalSources = computed(() => onlineApis.value.length + (adultMode.value ? avSources.value.length : 0))

const totalFail = computed(() =>
  onlineApis.value.filter(a => statusMap[a] === 'fail').length +
  (adultMode.value ? avSources.value.filter(s => avStatusMap[s.api] === 'fail').length : 0)
)

// ── Check all ───────────────────────────────────────────────
const checkingAll = ref(false)
const checkedCount = ref(0)

const checkAll = async () => {
  if (checkingAll.value) return
  checkingAll.value = true
  checkedCount.value = 0
  const onlineTasks = onlineApis.value.map(api =>
    checkOnlineSite(api, true).then(() => { checkedCount.value++ })
  )
  const avTasks = adultMode.value
    ? avSources.value.map(s => checkAvSite(s.api, true).then(() => { checkedCount.value++ }))
    : []
  await Promise.all([...onlineTasks, ...avTasks])
  checkingAll.value = false
}

const disableAllFailed = () => {
  Modal.confirm({
    title: `禁用 ${totalFail.value} 个失效数据源？`,
    content: '只会停用这些数据源，不会删除自定义配置。',
    okText: '禁用',
    cancelText: '取消',
    onOk: () => {
      for (const a of onlineApis.value) { if (statusMap[a] === 'fail') selectedSites.delete(a) }
      for (const s of avSources.value) { if (avStatusMap[s.api] === 'fail') avEnabledApis.delete(s.api) }
    },
  })
}

// ── 每次打开时自动同步并检测 ─────────────────────────────────
const refreshingOnOpen = ref(false)
const sourceActivityText = computed(() => {
  if (syncingAv.value) return '正在同步在线数据源…'
  if (checkingAll.value) return `正在检测 ${checkedCount.value}/${totalSources.value}`
  return '打开时自动同步并检测'
})
const refreshSourcesOnOpen = async () => {
  if (refreshingOnOpen.value) return
  refreshingOnOpen.value = true
  try {
    await Promise.all([loadCatSpiderSites(), syncAvSources(false)])
    await checkAll()
  } finally {
    refreshingOnOpen.value = false
  }
}
watch(
  () => props.visible,
  visible => {
    if (visible) void refreshSourcesOnOpen()
  }
)

// ── Tabs ────────────────────────────────────────────────────
const activeTab = ref('online')
const tabs = computed(() => [
  { id: 'online', label: '在线源', count: onlineApis.value.length + visibleCatSpiderSites.value.length },
  ...(adultMode.value ? [{ id: 'av', label: 'AV源', count: avSources.value.length }] : []),
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
  if (customSites.value.some(site => site.api === api) || avSources.value.some(site => site.api === api)) {
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
    message.error(error instanceof Error ? error.message : '数据源分析失败，请检查接口地址')
  } finally {
    addingSource.value = false
  }
}

const removeCustom = (idx: number) => {
  const site = customSites.value[idx]
  Modal.confirm({
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
import { defineComponent as dc, h as ch, computed as cc } from 'vue'

export const SiteCard = dc({
  name: 'SiteCard',
  props: {
    name: String, api: String, badge: String,
    badgeColor: { type: String, default: 'blue' },
    enabled: Boolean, status: String, checking: Boolean, deletable: Boolean,
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
    return () => ch('div', {
      class: ['site-card', props.enabled ? 'active' : '', props.status === 'fail' ? 'fail' : ''].join(' ').trim(),
      onClick: () => emit('toggle'),
    }, [
      ch('div', { class: 'card-top' }, [
        ch('span', { class: dotClass.value }),
        ch('span', { class: 'card-name' }, props.name),
        ch('em', { class: badgeClass.value }, props.badge),
        ch('button', {
          class: 'icon-btn', disabled: props.checking,
          title: '检测数据源', 'aria-label': `检测数据源 ${props.name}`,
          style: props.checking ? 'animation:spin 1s linear infinite' : '',
          onClick: (e: Event) => { e.stopPropagation(); emit('check') },
        }, [ch('svg', { viewBox: '0 0 24 24', width: 11, height: 11, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, [
          ch('path', { d: 'M4 4v5h5M20 20v-5h-5' }),
          ch('path', { d: 'M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4' }),
        ])]),
        props.deletable ? ch('button', {
          class: 'icon-btn danger',
          title: '删除数据源', 'aria-label': `删除数据源 ${props.name}`,
          onClick: (e: Event) => { e.stopPropagation(); emit('delete') },
        }, [ch('svg', { viewBox: '0 0 24 24', width: 11, height: 11, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, [
          ch('polyline', { points: '3 6 5 6 21 6' }),
          ch('path', { d: 'M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2' }),
        ])]) : null,
      ]),
      ch('span', { class: 'card-api' }, props.api),
      props.enabled ? ch('div', { class: 'check-mark' }, '✓') : null,
    ])
  }
})
</script>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

.smp-backdrop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.36);
  display: flex; justify-content: flex-end;
}

.smp-panel {
  width: min(520px, calc(100vw - 48px));
  height: 100vh;
  background: var(--bg-panel);
  border-left: 1px solid var(--separator);
  color: var(--text-primary);
  backdrop-filter: blur(var(--blur-panel)) saturate(var(--saturate-vibrancy));
  -webkit-backdrop-filter: blur(var(--blur-panel)) saturate(var(--saturate-vibrancy));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  transition: var(--transition-panel);
}

.smp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 22px 14px;
  flex-shrink: 0;
}
.smp-title {
  font-size: var(--text-2xl);
  letter-spacing: -0.022em;
}
.smp-subtitle { margin: 4px 0 0; font-size: var(--text-sm); }
.smp-header-actions { display: flex; align-items: center; gap: 8px; }
.smp-fail-btn {
  min-height: 28px;
  font-size: 12px;
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.smp-close {
  width: 30px; height: 30px; border-radius: var(--radius-md);
  background: var(--bg-fill-secondary); border: 0;
  color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: var(--transition-fast);
}
.smp-close:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
.smp-close:active { transform: scale(0.94); }

.smp-tabs-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 22px 14px;
  flex-shrink: 0;
}
.smp-seg { flex: 1; }
.smp-seg .yb-seg { flex: 1; min-height: 30px; font-size: var(--text-sm); }
.tab-count {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.smp-seg .yb-seg.is-active .tab-count { color: var(--accent-text); }
.smp-status {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.smp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 18px 28px;
}
.smp-body::-webkit-scrollbar { width: 6px; }
.smp-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 4px 10px;
}
.section-header.mt { margin-top: 22px; }
.section-header .yb-section-title {
  font-size: var(--text-sm);
  letter-spacing: -0.01em;
  color: var(--text-secondary);
}
.section-header .yb-section-count {
  display: inline;
  font-size: 12px;
}

.add-btn {
  margin-left: auto;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 0;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-fast);
}
.add-btn:hover { background: color-mix(in srgb, var(--accent) 28%, transparent); }
.add-btn:active { transform: scale(0.97); }

.empty {
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 16px 8px;
  text-align: center;
}

.card-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

:deep(.site-card) {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  min-height: 52px;
  padding: 10px 14px;
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
:deep(.site-card:last-child) { border-bottom: 0; }
:deep(.site-card:hover) { background: var(--bg-fill-secondary); }
:deep(.site-card:active) { transform: scale(0.995); }
:deep(.site-card.active) { background: var(--bg-active-soft); }
:deep(.site-card.active .card-name) { color: var(--accent-text); font-weight: 600; }
:deep(.site-card.fail .card-name) { color: var(--danger); }
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
  font-size: 11px;
  color: var(--text-tertiary);
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.site-card:hover .card-api) { display: block; }
:deep(.badge) {
  font-style: normal;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
:deep(.badge-blue) {
  color: var(--accent-text);
  background: var(--accent-soft);
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
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-quaternary);
}
:deep(.dot.ok) { background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
:deep(.dot.fail) { background: var(--danger); }
:deep(.dot.checking) { background: var(--warning); animation: pulse 1s infinite; }
:deep(.icon-btn) {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer; transition: var(--transition-fast); padding: 0;
}
:deep(.icon-btn:hover:not(:disabled)) {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
:deep(.icon-btn:disabled) { opacity: .35; cursor: not-allowed; }
:deep(.site-card .icon-btn) { opacity: 0; }
:deep(.site-card:hover .icon-btn),
:deep(.site-card:focus-within .icon-btn) { opacity: 1; }
:deep(.icon-btn.danger:hover) {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}
:deep(.check-mark) {
  font-size: 12px;
  color: var(--accent);
  font-weight: 700;
  pointer-events: none;
}

.add-dialog {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.42);
}
.add-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 22px;
  width: min(400px, calc(100vw - 48px));
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}
.add-panel .yb-section-title { margin-bottom: 6px; }
.hint { font-size: 12px; color: var(--text-tertiary); margin: 0 0 14px; line-height: 1.4; }
.add-label { display: block; margin: 10px 0 6px; }
.add-panel .yb-field { margin-bottom: 2px; }
.add-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.panel-fade-enter-active,
.panel-fade-leave-active { transition: opacity 0.3s var(--ease-out); }
.panel-fade-enter-from,
.panel-fade-leave-to { opacity: 0; }
.panel-fade-enter-active .smp-panel,
.panel-fade-leave-active .smp-panel { transition: var(--transition-panel); }
.panel-fade-enter-from .smp-panel,
.panel-fade-leave-to .smp-panel { transform: translateX(100%); }

@media (prefers-reduced-transparency: reduce) {
  .smp-panel { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--bg-elevated); }
}
@media (prefers-reduced-motion: reduce) {
  .panel-fade-enter-active,
  .panel-fade-leave-active,
  .panel-fade-enter-active .smp-panel,
  .panel-fade-leave-active .smp-panel {
    transition: opacity 0.2s ease;
  }
  .panel-fade-enter-from .smp-panel,
  .panel-fade-leave-to .smp-panel { transform: none; }
  :deep(.site-card:active),
  .smp-close:active,
  .add-btn:active { transform: none; }
}
</style>
