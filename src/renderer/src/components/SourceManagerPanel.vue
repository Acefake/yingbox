<template>
  <Teleport to="body">
    <Transition name="panel-fade">
      <div v-if="visible" class="smp-backdrop" @click.self="emit('close')">
        <div class="smp-panel">
          <!-- Header -->
          <div class="smp-header">
            <span class="smp-title">数据源管理</span>
            <div class="smp-stats">
              <span class="stat ok">{{ totalOk }} 正常</span>
              <span class="stat fail">{{ totalFail }} 失效</span>
              <span class="stat unk">{{ totalUnk }} 未检测</span>
            </div>
            <div class="smp-header-actions">
              <button class="tool-btn warn" :disabled="totalFail === 0" @click="disableAllFailed">
                <IconBan /> 禁用失效
              </button>
              <button class="tool-btn primary" :disabled="checkingAll" @click="checkAll">
                <IconRefresh :spinning="checkingAll" />
                {{ checkingAll ? `检测中 ${checkedCount}/${totalSources}` : '一键检测' }}
              </button>
              <button class="smp-close" aria-label="关闭数据源管理" @click="emit('close')">✕</button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="smp-tabs">
            <button v-for="t in tabs" :key="t.id" class="smp-tab" :class="{ active: activeTab === t.id }"
              @click="activeTab = t.id">
              {{ t.label }}
              <span class="tab-count">{{ t.count }}</span>
            </button>
          </div>

          <div class="smp-body">
            <!-- 在线CMS源 -->
            <template v-if="activeTab === 'online'">
              <div class="section-header">
                <span class="section-title">内置 CMS 源</span>
                <span class="section-count">{{ DEFAULT_SITES.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in DEFAULT_SITES" :key="s.api" :name="s.name" :api="s.api" badge="CMS"
                  :enabled="selectedSites.has(s.api)" :status="statusOf(s.api)" :checking="checkingSet.has(s.api)"
                  @toggle="toggleOnline(s.api)" @check="checkOnlineSite(s.api)" />
              </div>

              <div class="section-header mt">
                <span class="section-title">CatSpider 插件源</span>
                <span class="section-count">{{ CATSPIDER_SITES.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in CATSPIDER_SITES" :key="s.api" :name="s.name" :api="s.api" badge="VOD"
                  badge-color="purple" :enabled="selectedCatSpider.includes(s.api)" status="ok" :checking="false"
                  @toggle="toggleCatSpider(s.api)" @check="() => {}" />
              </div>

              <div class="section-header mt">
                <span class="section-title">自定义源</span>
                <button class="add-btn" @click="showAdd = true">+ 添加</button>
              </div>
              <div v-if="customSites.length === 0" class="empty">暂无自定义源</div>
              <div v-else class="card-grid">
                <SiteCard v-for="(s, i) in customSites" :key="s.api + i" :name="s.name" :api="s.api" badge="自定义"
                  badge-color="amber" :enabled="selectedSites.has(s.api)" :status="statusOf(s.api)"
                  :checking="checkingSet.has(s.api)" deletable @toggle="toggleOnline(s.api)"
                  @check="checkOnlineSite(s.api)" @delete="removeCustom(i)" />
              </div>
            </template>

            <!-- AV源 -->
            <template v-if="activeTab === 'av'">
              <div class="section-header">
                <span class="section-title">AV 资源站点</span>
                <span class="section-count">{{ AV_SOURCES.length }}</span>
              </div>
              <div class="card-grid">
                <SiteCard v-for="s in AV_SOURCES" :key="s.api" :name="s.name" :api="s.api" badge="AV"
                  badge-color="pink" :enabled="avEnabledApis.has(s.api)" :status="avStatusOf(s.api)"
                  :checking="avCheckingSet.has(s.api)" @toggle="toggleAv(s.api)" @check="checkAvSite(s.api)" />
              </div>
            </template>
          </div>
        </div>

        <!-- Add custom source dialog -->
        <div v-if="showAdd" class="add-dialog" @click.self="showAdd = false">
          <div class="add-panel">
            <h3>添加自定义源</h3>
            <p class="hint">苹果CMS v10 接口，如：https://xxx.com/api.php/provide/vod</p>
            <input v-model="newName" class="add-input" placeholder="名称" />
            <input v-model="newApi" class="add-input" placeholder="API 地址" @keydown.enter="addCustom" />
            <div class="add-actions">
              <button class="btn-cancel" @click="showAdd = false">取消</button>
              <button class="btn-confirm" @click="addCustom">确认添加</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, defineComponent, h, onUnmounted } from 'vue'
import axios from 'axios'
import { Modal, message } from 'ant-design-vue'
import { useOnlineSearch } from '@/views/online/composables/use-online-search'
import { AV_SOURCES, useAvSources } from '@/views/av/use-av-sources'

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

// ── Inline icon helpers ──────────────────────────────────────
const IconBan = defineComponent({
  setup: () => () => h('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, [
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 4.93, y1: 4.93, x2: 19.07, y2: 19.07 }),
  ])
})
const IconRefresh = defineComponent({
  props: { spinning: Boolean },
  setup: (p) => () => h('svg', {
    viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    style: p.spinning ? 'animation:spin 1s linear infinite' : ''
  }, [
    h('path', { d: 'M4 4v5h5M20 20v-5h-5' }),
    h('path', { d: 'M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4' }),
  ])
})

// ── Online sources ───────────────────────────────────────────
const { selectedSites, customSites, DEFAULT_SITES, CATSPIDER_SITES, selectedCatSpider } = useOnlineSearch()

type SiteStatus = 'unknown' | 'checking' | 'ok' | 'fail'
const statusMap = reactive<Record<string, SiteStatus>>({})
const checkingSet = reactive<Set<string>>(new Set())

const statusOf = (api: string): SiteStatus => statusMap[api] ?? 'unknown'

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
const { enabledApis: avEnabledApis } = useAvSources()
const avStatusMap = reactive<Record<string, SiteStatus>>({})
const avCheckingSet = reactive<Set<string>>(new Set())

const avStatusOf = (api: string): SiteStatus => avStatusMap[api] ?? 'unknown'

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
const totalSources = computed(() => onlineApis.value.length + (adultMode.value ? AV_SOURCES.length : 0))

const totalOk = computed(() =>
  onlineApis.value.filter(a => statusMap[a] === 'ok').length +
  (adultMode.value ? AV_SOURCES.filter(s => avStatusMap[s.api] === 'ok').length : 0)
)
const totalFail = computed(() =>
  onlineApis.value.filter(a => statusMap[a] === 'fail').length +
  (adultMode.value ? AV_SOURCES.filter(s => avStatusMap[s.api] === 'fail').length : 0)
)
const totalUnk = computed(() => totalSources.value - totalOk.value - totalFail.value)

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
    ? AV_SOURCES.map(s => checkAvSite(s.api, true).then(() => { checkedCount.value++ }))
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
      for (const s of AV_SOURCES) { if (avStatusMap[s.api] === 'fail') avEnabledApis.delete(s.api) }
    },
  })
}

// ── Auto-check on app startup ───────────────────────────────
onMounted(() => {
  checkAll()
})

// ── Tabs ────────────────────────────────────────────────────
const activeTab = ref('online')
const tabs = computed(() => [
  { id: 'online', label: '在线源', count: onlineApis.value.length + CATSPIDER_SITES.length },
  ...(adultMode.value ? [{ id: 'av', label: 'AV源', count: AV_SOURCES.length }] : []),
])

// ── Custom source ────────────────────────────────────────────
const showAdd = ref(false)
const newName = ref('')
const newApi = ref('')

const addCustom = () => {
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
  if (customSites.value.some(site => site.api === api)) {
    message.info('这个数据源已经添加')
    return
  }
  customSites.value.push({ name, api })
  selectedSites.add(api)
  showAdd.value = false
  newName.value = ''
  newApi.value = ''
  checkOnlineSite(api)
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
    const badgeStyle = cc(() => {
      const map: Record<string, string> = {
        blue: 'color:#93c5fd;background:rgba(59,130,246,0.18)',
        purple: 'color:#c4b5fd;background:rgba(139,92,246,0.18)',
        pink: 'color:#f9a8d4;background:rgba(236,72,153,0.18)',
        amber: 'color:#fcd34d;background:rgba(245,158,11,0.18)',
      }
      return map[props.badgeColor || 'blue'] || map.blue
    })
    return () => ch('div', {
      class: ['site-card', props.enabled ? 'active' : '', props.status === 'fail' ? 'fail' : ''].join(' ').trim(),
      onClick: () => emit('toggle'),
    }, [
      ch('div', { class: 'card-top' }, [
        ch('span', { class: dotClass.value }),
        ch('span', { class: 'card-name' }, props.name),
        ch('em', { class: 'badge', style: badgeStyle.value }, props.badge),
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
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

.smp-backdrop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding-top: 80px; padding-right: 12px;
}

.smp-panel {
  width: 680px; max-height: calc(100vh - 100px);
  background: rgba(14,18,28,0.97);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  backdrop-filter: blur(20px);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.7);
}

.smp-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.smp-title { font-size: 14px; font-weight: 600; color: white; }
.smp-stats { display: flex; gap: 10px; font-size: 11px; flex: 1; }
.stat { padding: 2px 7px; border-radius: 10px; }
.stat.ok { color: #4ade80; background: rgba(74,222,128,0.1); }
.stat.fail { color: #f87171; background: rgba(248,113,113,0.1); }
.stat.unk { color: rgba(255,255,255,0.4); background: rgba(255,255,255,0.06); }

.smp-header-actions { display: flex; align-items: center; gap: 7px; }
.smp-close {
  width: 28px; height: 28px; border-radius: 7px;
  background: rgba(255,255,255,0.08); border: none;
  color: rgba(255,255,255,0.6); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.smp-close:hover { background: rgba(255,255,255,0.15); color: white; }

.tool-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 11px; border-radius: 7px; border: none;
  font-size: 12px; cursor: pointer; transition: all .15s;
}
.tool-btn:disabled { opacity: .4; cursor: not-allowed; }
.tool-btn.primary { background: rgba(99,102,241,.7); color: white; }
.tool-btn.primary:hover:not(:disabled) { background: rgba(99,102,241,1); }
.tool-btn.warn { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.22); }
.tool-btn.warn:hover:not(:disabled) { background: rgba(248,113,113,.22); }

.smp-tabs {
  display: flex; gap: 2px; padding: 10px 18px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.smp-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; background: none; border: none;
  color: rgba(255,255,255,.5); font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: all .15s;
}
.smp-tab:hover { color: rgba(255,255,255,.8); }
.smp-tab.active { color: white; border-bottom-color: #6366f1; }
.tab-count {
  font-size: 10px; background: rgba(255,255,255,.1);
  padding: 1px 5px; border-radius: 8px; color: rgba(255,255,255,.5);
}

.smp-body {
  flex: 1; overflow-y: auto; padding: 16px 18px 20px;
}
.smp-body::-webkit-scrollbar { width: 4px; }
.smp-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 2px; }

.section-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.section-header.mt { margin-top: 20px; }
.section-title { font-size: 13px; font-weight: 600; color: rgba(255,255,255,.75); flex: 1; }
.section-count {
  font-size: 11px; color: rgba(255,255,255,.35);
  background: rgba(255,255,255,.07); padding: 1px 7px; border-radius: 8px;
}

.add-btn {
  font-size: 11px; padding: 2px 9px; border-radius: 12px;
  background: transparent; border: 1px dashed rgba(255,255,255,.22);
  color: rgba(255,255,255,.45); cursor: pointer;
}
.add-btn:hover { color: white; border-color: rgba(255,255,255,.5); }

.empty { font-size: 12px; color: rgba(255,255,255,.3); padding: 8px 0; }

.card-grid {
  display: flex; flex-wrap: wrap; gap: 7px;
}

/* SiteCard styles (global-like via :deep or just apply in component) */
:deep(.site-card) {
  position: relative; width: 172px; flex-shrink: 0;
  padding: 9px 11px 7px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
  border-radius: 10px; cursor: pointer; transition: all .15s;
  display: flex; flex-direction: column; gap: 3px;
}
:deep(.site-card:hover) { background: rgba(255,255,255,.09); border-color: rgba(255,255,255,.14); }
:deep(.site-card.active) { background: rgba(99,102,241,.12); border-color: rgba(99,102,241,.35); }
:deep(.site-card.fail) { border-color: rgba(248,113,113,.2); }
:deep(.card-top) { display: flex; align-items: center; gap: 5px; }
:deep(.card-name) {
  font-size: 12px; font-weight: 500; color: rgba(255,255,255,.85);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
:deep(.card-api) {
  font-size: 10px; color: rgba(255,255,255,.28);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
:deep(.badge) {
  font-style: normal; font-size: 9px; font-weight: 600;
  padding: 1px 4px; border-radius: 3px; flex-shrink: 0;
}
:deep(.dot) {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,.2);
}
:deep(.dot.ok) { background: #4ade80; box-shadow: 0 0 4px #4ade80; }
:deep(.dot.fail) { background: #f87171; }
:deep(.dot.checking) { background: #facc15; animation: pulse 1s infinite; }
:deep(.icon-btn) {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  background: none; border: none; color: rgba(255,255,255,.35); border-radius: 4px;
  cursor: pointer; transition: all .15s; padding: 0;
}
:deep(.icon-btn:hover:not(:disabled)) { background: rgba(255,255,255,.1); color: white; }
:deep(.icon-btn:disabled) { opacity: .25; cursor: not-allowed; }
:deep(.icon-btn.danger:hover) { background: rgba(248,113,113,.2); color: #f87171; }
:deep(.check-mark) {
  position: absolute; top: 5px; right: 7px;
  font-size: 10px; color: #818cf8; font-weight: 700; pointer-events: none;
}

/* Add dialog */
.add-dialog {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.5);
}
.add-panel {
  background: #131825; border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px; padding: 22px; width: 380px; color: white;
}
.add-panel h3 { margin: 0 0 4px; font-size: 15px; }
.hint { font-size: 11px; color: rgba(255,255,255,.35); margin-bottom: 12px; }
.add-input {
  width: 100%; height: 36px; padding: 0 10px; box-sizing: border-box;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.13);
  border-radius: 7px; color: white; font-size: 12px; margin-bottom: 7px; outline: none;
}
.add-input:focus { border-color: rgba(99,102,241,.6); }
.add-input::placeholder { color: rgba(255,255,255,.3); }
.add-actions { display: flex; gap: 7px; justify-content: flex-end; margin-top: 4px; }
.btn-cancel {
  padding: 5px 14px; border-radius: 7px;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.13);
  color: rgba(255,255,255,.7); cursor: pointer; font-size: 12px;
}
.btn-confirm {
  padding: 5px 14px; border-radius: 7px;
  background: rgba(99,102,241,.75); border: none; color: white;
  cursor: pointer; font-size: 12px;
}
.btn-confirm:hover { background: rgba(99,102,241,1); }

.panel-fade-enter-active, .panel-fade-leave-active { transition: opacity .2s, transform .2s; }
.panel-fade-enter-from, .panel-fade-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
