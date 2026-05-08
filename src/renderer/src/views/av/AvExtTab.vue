<template>
  <div class="content-area ext-tab">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="toolbar-stat">
          共 <b>{{ avSources.length }}</b> 个源 ·
          <span class="stat-ok">{{ okCount }} 正常</span> ·
          <span class="stat-fail">{{ failCount }} 失效</span> ·
          <span class="stat-unknown">{{ unknownCount }} 未检测</span>
        </span>
      </div>
      <div class="toolbar-right">
        <button
          class="tool-btn warn"
          :disabled="failCount === 0"
          @click="disableFailed"
          title="禁用所有失效源"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          禁用失效 ({{ failCount }})
        </button>
        <button
          class="tool-btn primary"
          :disabled="checkingAll"
          @click="checkAll"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"
            :style="checkingAll ? 'animation:spin 1s linear infinite' : ''">
            <path d="M4 4v5h5M20 20v-5h-5" />
            <path d="M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4" />
          </svg>
          {{ checkingAll ? `检测中 ${checkedCount}/${avSources.length}` : '一键检测全部' }}
        </button>
      </div>
    </div>

    <!-- AV 站点列表 -->
    <div class="ext-section">
      <div class="section-header">
        <span class="section-title">AV 资源站点</span>
        <span class="section-count">{{ avSources.length }} 个</span>
      </div>
      <div class="card-grid">
        <div
          v-for="site in avSources"
          :key="site.api"
          class="site-card"
          :class="{
            active: enabledApis.has(site.api),
            fail: statusOf(site.api) === 'fail',
          }"
          @click="toggleSite(site.api)"
        >
          <div class="card-top">
            <span :class="['status-dot', statusOf(site.api)]" :title="statusLabel(site.api)" />
            <span class="card-name">{{ site.name }}</span>
            <em class="custom-badge">AV</em>
            <button
              class="icon-btn ml-auto"
              :disabled="checkingSet.has(site.api)"
              @click.stop="checkSite(site.api)"
              title="检测"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"
                :style="checkingSet.has(site.api) ? 'animation:spin 1s linear infinite' : ''">
                <path d="M4 4v5h5M20 20v-5h-5" />
                <path d="M4 9a8 8 0 0 1 16 0 8 8 0 0 1-4.9 7.4" />
              </svg>
            </button>
          </div>
          <span class="card-api">{{ site.api }}</span>
          <div class="card-check-mark" v-if="enabledApis.has(site.api)">✓</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import axios from 'axios'
import { AV_SOURCES, useAvSources, type AvSite } from './use-av-sources'

const { enabledApis } = useAvSources()

const avSources: AvSite[] = AV_SOURCES

// ─── 启用/禁用 ────────────────────────────────────────────────
const toggleSite = (api: string) => {
  if (enabledApis.has(api)) enabledApis.delete(api)
  else enabledApis.add(api)
}

// ─── 健康检测 ─────────────────────────────────────────────────
type SiteStatus = 'unknown' | 'checking' | 'ok' | 'fail'
const statusMap = reactive<Record<string, SiteStatus>>({})
const checkingSet = reactive<Set<string>>(new Set())

const checkSite = async (api: string, autoEnable = false) => {
  if (checkingSet.has(api)) return
  const prevStatus = statusMap[api]
  checkingSet.add(api)
  statusMap[api] = 'checking'
  try {
    const res = await axios.get(`${api}?ac=detail`, { timeout: 8000 })
    const isOk = res.data?.list !== undefined
    statusMap[api] = isOk ? 'ok' : 'fail'
    if (isOk && (autoEnable || prevStatus === 'fail' || prevStatus === 'unknown')) {
      enabledApis.add(api)
    }
  } catch {
    statusMap[api] = 'fail'
  } finally {
    checkingSet.delete(api)
  }
}

const checkingAll = ref(false)
const checkedCount = ref(0)

const checkAll = async () => {
  if (checkingAll.value) return
  checkingAll.value = true
  checkedCount.value = 0
  await Promise.all(
    avSources.map(s =>
      checkSite(s.api, true).then(() => { checkedCount.value++ })
    )
  )
  checkingAll.value = false
}

const disableFailed = () => {
  for (const s of avSources) {
    if (statusMap[s.api] === 'fail') enabledApis.delete(s.api)
  }
}

const statusOf = (api: string): SiteStatus => statusMap[api] ?? 'unknown'
const statusLabel = (api: string) => {
  const s = statusOf(api)
  return s === 'ok' ? '正常' : s === 'fail' ? '失效' : s === 'checking' ? '检测中…' : '未检测'
}

const okCount = computed(() => avSources.filter(s => statusMap[s.api] === 'ok').length)
const failCount = computed(() => avSources.filter(s => statusMap[s.api] === 'fail').length)
const unknownCount = computed(() => avSources.filter(s => !statusMap[s.api] || statusMap[s.api] === 'unknown').length)
</script>

<style scoped>
.ext-tab { padding: 16px 0; }
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 12px; flex-wrap: wrap; gap: 8px;
}
.toolbar-left { font-size: 12px; color: rgba(255,255,255,0.5); }
.toolbar-stat b { color: rgba(255,255,255,0.8); }
.stat-ok { color: #4ade80; }
.stat-fail { color: #f87171; }
.stat-unknown { color: rgba(255,255,255,0.35); }
.toolbar-right { display: flex; gap: 8px; }
.tool-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 6px; border: none;
  font-size: 12px; cursor: pointer; transition: all 0.2s;
}
.tool-btn.primary { background: rgba(59,130,246,0.25); color: #93c5fd; }
.tool-btn.primary:hover:not(:disabled) { background: rgba(59,130,246,0.4); }
.tool-btn.warn { background: rgba(239,68,68,0.15); color: #fca5a5; }
.tool-btn.warn:hover:not(:disabled) { background: rgba(239,68,68,0.3); }
.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.ext-section { margin-bottom: 24px; }
.section-header {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px;
}
.section-title { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); }
.section-count {
  font-size: 11px; color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.08); padding: 1px 7px; border-radius: 10px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.site-card {
  position: relative; padding: 10px 12px;
  border-radius: 10px; cursor: pointer;
  border: 1.5px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  transition: all 0.18s;
}
.site-card:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); }
.site-card.active { border-color: rgba(59,130,246,0.6); background: rgba(59,130,246,0.1); }
.site-card.fail { border-color: rgba(239,68,68,0.3); }

.card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.card-name { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.85); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-api { font-size: 10px; color: rgba(255,255,255,0.3); word-break: break-all; display: block; }
.card-check-mark {
  position: absolute; top: 6px; right: 8px;
  font-size: 11px; color: #60a5fa; font-weight: bold;
}

.status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,0.2);
}
.status-dot.ok { background: #4ade80; }
.status-dot.fail { background: #f87171; }
.status-dot.checking { background: #facc15; animation: pulse 1s infinite; }
.status-dot.unknown { background: rgba(255,255,255,0.2); }

.custom-badge {
  font-size: 9px; font-style: normal; font-weight: 600;
  padding: 1px 5px; border-radius: 4px;
  background: rgba(236,72,153,0.25); color: #f9a8d4;
}
.ml-auto { margin-left: auto; }

.icon-btn {
  background: none; border: none; cursor: pointer;
  color: rgba(255,255,255,0.4); padding: 2px;
  display: flex; align-items: center;
  transition: color 0.15s;
}
.icon-btn:hover:not(:disabled) { color: rgba(255,255,255,0.8); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
</style>
