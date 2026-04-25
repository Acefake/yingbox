<template>
  <div class="content-area ext-tab">

    <!-- 全局工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="toolbar-stat">
          共 <b>{{ allSites.length }}</b> 个源 ·
          <span class="stat-ok">{{ okCount }} 正常</span> ·
          <span class="stat-fail">{{ failCount }} 失效</span> ·
          <span class="stat-unknown">{{ unknownCount }} 未检测</span>
        </span>
      </div>
      <div class="toolbar-right">
        <button class="tool-btn warn" :disabled="failCount === 0" @click="disableFailed" title="禁用所有失效源">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          禁用失效 ({{ failCount }})
        </button>
        <button class="tool-btn primary" :disabled="checkingAll" @click="checkAll">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"
            :style="checkingAll ? 'animation:spin 1s linear infinite' : ''">
            <path d="M4 4v5h5M20 20v-5h-5"/><path d="M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4"/>
          </svg>
          {{ checkingAll ? `检测中 ${checkedCount}/${allSites.length}` : '一键检测全部' }}
        </button>
      </div>
    </div>

    <!-- 内置源 -->
    <div class="ext-section">
      <div class="section-header">
        <span class="section-title">内置数据源</span>
        <span class="section-count">{{ DEFAULT_SITES.length }} 个</span>
      </div>
      <div class="card-grid">
        <div v-for="site in DEFAULT_SITES" :key="site.api"
          class="site-card"
          :class="{ active: selectedSites.has(site.api), fail: statusOf(site.api) === 'fail' }"
          @click="toggleSite(site.api)">
          <div class="card-top">
            <span :class="['status-dot', statusOf(site.api)]" :title="statusLabel(site.api)" />
            <span class="card-name">{{ site.name }}</span>
            <button class="icon-btn ml-auto" :disabled="checkingSet.has(site.api)"
              @click.stop="checkSite(site.api)" title="检测">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"
                :style="checkingSet.has(site.api) ? 'animation:spin 1s linear infinite' : ''">
                <path d="M4 4v5h5M20 20v-5h-5"/><path d="M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4"/>
              </svg>
            </button>
          </div>
          <span class="card-api">{{ site.api }}</span>
          <div class="card-check-mark" v-if="selectedSites.has(site.api)">✓</div>
        </div>
      </div>
    </div>

    <!-- 自定义源 -->
    <div class="ext-section">
      <div class="section-header">
        <span class="section-title">自定义数据源</span>
        <button class="add-source-btn" @click="openAdd">+ 添加源</button>
      </div>
      <div v-if="customSites.length === 0" class="empty-custom">暂无自定义源，点击「添加源」新增</div>
      <div v-else class="card-grid">
        <div v-for="(site, idx) in customSites" :key="site.api + idx"
          class="site-card custom"
          :class="{ active: selectedSites.has(site.api), fail: statusOf(site.api) === 'fail', editing: editIdx === idx }">

          <!-- 普通展示态 -->
          <template v-if="editIdx !== idx">
            <div class="card-top" @click="toggleSite(site.api)">
              <span :class="['status-dot', statusOf(site.api)]" :title="statusLabel(site.api)" />
              <span class="card-name">{{ site.name }}</span>
              <em class="custom-badge">自定义</em>
            </div>
            <span class="card-api" @click="toggleSite(site.api)">{{ site.api }}</span>
            <div class="card-footer">
              <button class="icon-btn" :disabled="checkingSet.has(site.api)"
                @click.stop="checkSite(site.api)" title="检测">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"
                  :style="checkingSet.has(site.api) ? 'animation:spin 1s linear infinite' : ''">
                  <path d="M4 4v5h5M20 20v-5h-5"/><path d="M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4"/>
                </svg>
              </button>
              <button class="icon-btn" @click.stop="startEdit(idx)" title="编辑">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="icon-btn danger" @click.stop="removeSite(idx)" title="删除">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
            <div class="card-check-mark" v-if="selectedSites.has(site.api)">✓</div>
          </template>

          <!-- 编辑态 -->
          <template v-else>
            <div class="edit-form">
              <input v-model="editName" class="edit-input" placeholder="名称" @keydown.enter="saveEdit(idx)" />
              <input v-model="editApi" class="edit-input" placeholder="API 地址" @keydown.enter="saveEdit(idx)" />
              <div class="edit-actions">
                <button class="cancel-btn sm" @click.stop="editIdx = -1">取消</button>
                <button class="confirm-btn sm" @click.stop="saveEdit(idx)">保存</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 添加源弹窗 -->
    <Teleport to="body">
      <div v-if="showAddSource" class="modal-backdrop" @click.self="showAddSource = false">
        <div class="add-source-panel">
          <h3>添加自定义源</h3>
          <p class="hint">苹果CMS v10 接口地址，格式：https://xxx.com/api.php/provide/vod</p>
          <input v-model="newSiteName" class="add-input" placeholder="名称，如：某某影视" />
          <input v-model="newSiteApi" class="add-input" placeholder="API 地址" @keydown.enter="addSite" />
          <div class="add-actions">
            <button class="cancel-btn" @click="showAddSource = false">取消</button>
            <button class="confirm-btn" :disabled="adding" @click="addSite">确认添加</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import axios from 'axios'
import { useOnlineSearch } from '../composables/use-online-search'

const { selectedSites, customSites, DEFAULT_SITES } = useOnlineSearch()

const allSites = computed(() => [
  ...DEFAULT_SITES.map(s => s.api),
  ...customSites.value.map(s => s.api),
])

const toggleSite = (api: string) => {
  if (selectedSites.has(api)) selectedSites.delete(api)
  else selectedSites.add(api)
}

// ─── 健康检测 ─────────────────────────────────────────────
type SiteStatus = 'unknown' | 'checking' | 'ok' | 'fail'
const statusMap = reactive<Record<string, SiteStatus>>({})
const checkingSet = reactive<Set<string>>(new Set())

const checkSite = async (api: string, autoEnable = false) => {
  if (checkingSet.has(api)) return
  const prevStatus = statusMap[api]
  checkingSet.add(api)
  statusMap[api] = 'checking'
  try {
    const res = await axios.get(`${api}?ac=videolist&wd=test`, { timeout: 8000 })
    const isOk = res.data?.list !== undefined
    statusMap[api] = isOk ? 'ok' : 'fail'
    // 之前是失效/未知，现在恢复正常，自动启用
    if (isOk && (autoEnable || prevStatus === 'fail' || prevStatus === 'unknown')) {
      selectedSites.add(api)
    }
  } catch {
    statusMap[api] = 'fail'
  } finally {
    checkingSet.delete(api)
  }
}

// 一键检测全部（包含禁用的），完成后恢复正常的自动启用
const checkingAll = ref(false)
const checkedCount = ref(0)

const checkAll = async () => {
  if (checkingAll.value) return
  checkingAll.value = true
  checkedCount.value = 0
  const apis = allSites.value
  await Promise.all(apis.map(api =>
    checkSite(api, true).then(() => { checkedCount.value++ })
  ))
  checkingAll.value = false
}

// 一键禁用失效源
const disableFailed = () => {
  for (const api of allSites.value) {
    if (statusMap[api] === 'fail') selectedSites.delete(api)
  }
}

const statusOf = (api: string): SiteStatus => statusMap[api] ?? 'unknown'
const statusLabel = (api: string) => {
  const s = statusOf(api)
  return s === 'ok' ? '正常' : s === 'fail' ? '失效' : s === 'checking' ? '检测中…' : '未检测'
}

const okCount = computed(() => allSites.value.filter(a => statusMap[a] === 'ok').length)
const failCount = computed(() => allSites.value.filter(a => statusMap[a] === 'fail').length)
const unknownCount = computed(() => allSites.value.filter(a => !statusMap[a] || statusMap[a] === 'unknown').length)

// ─── 编辑自定义源 ─────────────────────────────────────────
const editIdx = ref(-1)
const editName = ref('')
const editApi = ref('')

const startEdit = (idx: number) => {
  editIdx.value = idx
  editName.value = customSites.value[idx].name
  editApi.value = customSites.value[idx].api
}

const saveEdit = (idx: number) => {
  const name = editName.value.trim()
  const api = editApi.value.trim()
  if (!name || !api) return
  const old = customSites.value[idx]
  if (old.api !== api) {
    selectedSites.delete(old.api)
    selectedSites.add(api)
    delete statusMap[old.api]
  }
  const updated = [...customSites.value]
  updated[idx] = { name, api }
  customSites.value = updated
  editIdx.value = -1
  checkSite(api)
}

const removeSite = (idx: number) => {
  const api = customSites.value[idx].api
  selectedSites.delete(api)
  delete statusMap[api]
  customSites.value = customSites.value.filter((_, i) => i !== idx)
  if (editIdx.value === idx) editIdx.value = -1
}

// ─── 添加源 ───────────────────────────────────────────────
const showAddSource = ref(false)
const newSiteName = ref('')
const newSiteApi = ref('')
const adding = ref(false)

const openAdd = () => {
  newSiteName.value = ''
  newSiteApi.value = ''
  showAddSource.value = true
}

const addSite = () => {
  const name = newSiteName.value.trim()
  const api = newSiteApi.value.trim()
  if (!name || !api) return
  adding.value = true
  customSites.value.push({ name, api })
  selectedSites.add(api)
  showAddSource.value = false
  adding.value = false
  checkSite(api)
}
</script>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { to { opacity: 0.3; } }

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.content-area::-webkit-scrollbar { width: 4px; }
.content-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-left { font-size: 12px; color: rgba(255,255,255,0.45); }
.toolbar-left b { color: rgba(255,255,255,0.75); font-weight: 600; }
.stat-ok { color: #34d399; }
.stat-fail { color: #f87171; }
.stat-unknown { color: rgba(255,255,255,0.35); }
.toolbar-right { display: flex; gap: 8px; }

.tool-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 7px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tool-btn.primary { background: rgba(99,102,241,0.7); color: white; }
.tool-btn.primary:hover:not(:disabled) { background: rgba(99,102,241,1); }
.tool-btn.warn { background: rgba(248,113,113,0.15); color: #f87171; border: 1px solid rgba(248,113,113,0.25); }
.tool-btn.warn:hover:not(:disabled) { background: rgba(248,113,113,0.25); }

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.section-title { font-size: 15px; font-weight: 600; color: rgba(255,255,255,0.75); flex: 1; }
.section-count { font-size: 11px; color: rgba(255,255,255,0.3); }

.add-source-btn {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 20px;
  background: transparent;
  border: 1px dashed rgba(255,255,255,0.25);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  transition: all 0.15s;
}
.add-source-btn:hover { color: white; border-color: rgba(255,255,255,0.5); }

.empty-custom { font-size: 13px; color: rgba(255,255,255,0.3); padding: 16px 0; }

/* ── 卡片网格 ── */
.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.site-card {
  position: relative;
  width: 180px;
  flex-shrink: 0;
  padding: 10px 12px 8px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.site-card:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.14); }
.site-card.active { background: rgba(99,102,241,0.14); border-color: rgba(99,102,241,0.35); }
.site-card.fail { border-color: rgba(248,113,113,0.2); }
.site-card.editing { width: 340px; cursor: default; }

.card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255,0.85);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-api {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-badge {
  font-style: normal;
  font-size: 9px;
  color: #a78bfa;
  background: rgba(167,139,250,0.15);
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.card-footer {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}

.card-check-mark {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 10px;
  color: #818cf8;
  font-weight: 700;
  pointer-events: none;
}

/* ── 状态点 ── */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255,255,255,0.2);
}
.status-dot.ok { background: #34d399; box-shadow: 0 0 4px #34d399; }
.status-dot.fail { background: #f87171; }
.status-dot.checking { background: #fbbf24; animation: pulse 0.7s ease-in-out infinite alternate; }

/* ── 图标按钮 ── */
.icon-btn {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  color: rgba(255,255,255,0.35);
  border-radius: 4px; cursor: pointer;
  transition: all 0.15s;
}
.icon-btn:hover { background: rgba(255,255,255,0.1); color: white; }
.icon-btn:disabled { opacity: 0.25; cursor: not-allowed; }
.icon-btn.danger:hover { background: rgba(248,113,113,0.2); color: #f87171; }
.ml-auto { margin-left: auto; }

/* ── 编辑表单（内嵌在卡片里） ── */
.edit-form { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.edit-input {
  width: 100%; height: 28px; padding: 0 8px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 5px; color: white; font-size: 12px;
  outline: none; box-sizing: border-box;
}
.edit-input::placeholder { color: rgba(255,255,255,0.3); }
.edit-actions { display: flex; gap: 5px; justify-content: flex-end; }

/* ── 弹窗 ── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.add-source-panel {
  background: #1a2030;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px; padding: 24px; width: 400px; color: white;
}
.add-source-panel h3 { margin: 0 0 4px; font-size: 16px; }
.hint { font-size: 12px; color: rgba(255,255,255,0.35); margin-bottom: 14px; }
.add-input {
  width: 100%; height: 38px; padding: 0 12px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 8px; color: white; font-size: 13px;
  margin-bottom: 8px; box-sizing: border-box; outline: none;
}
.add-input::placeholder { color: rgba(255,255,255,0.3); }
.add-input:focus { border-color: rgba(99,102,241,0.6); }
.add-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }

.cancel-btn {
  padding: 6px 16px; border-radius: 7px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.13);
  color: rgba(255,255,255,0.7); cursor: pointer; font-size: 13px;
}
.cancel-btn.sm { padding: 4px 10px; font-size: 12px; }

.confirm-btn {
  padding: 6px 16px; border-radius: 7px;
  background: rgba(99,102,241,0.75);
  border: none; color: white; cursor: pointer; font-size: 13px;
  transition: background 0.15s;
}
.confirm-btn:hover:not(:disabled) { background: rgba(99,102,241,1); }
.confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.confirm-btn.sm { padding: 4px 10px; font-size: 12px; }
</style>
