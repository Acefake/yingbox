<template>
  <section class="amane-agent" aria-label="智能体">
    <aside class="agent-sessions">
      <div class="agent-session-heading"><strong>对话</strong><IconButton icon="plus" label="新建对话" :disabled="busy || loadingTrace" @click="createSession" /></div>
      <p v-if="!sessions.length" class="amane-muted">新建对话，开始查询片库</p>
      <div v-for="session in sessions" :key="session.id" class="agent-session-row" :class="{ active: session.id === selected }">
        <input v-if="renaming === session.id" v-model="renameText" class="yb-field" maxlength="200" aria-label="对话名称" @keydown.enter.prevent="renameSession(session.id)" @keydown.esc="renaming = null" />
        <button v-else type="button" class="agent-session-link" :aria-current="selected === session.id ? 'page' : undefined" @click="selectSession(session.id)">{{ session.title }}<small v-if="session.status === 'awaiting_approval'">等待审批</small></button>
        <IconButton v-if="renaming === session.id" icon="check" label="保存对话名称" :disabled="busy || !renameText.trim()" @click="renameSession(session.id)" />
        <IconButton v-else icon="file" label="重命名对话" :disabled="busy" @click="renaming = session.id; renameText = session.title" />
        <IconButton icon="trash" label="删除对话" danger :disabled="busy || (selected === session.id && running)" @click="deleteSession(session)" />
      </div>
    </aside>
    <div class="agent-conversation">
      <header class="agent-toolbar">
        <div class="agent-toolbar-title"><AppIcon :name="showQueries ? 'database' : 'sparkle'" /><span>{{ showQueries ? '查询预设' : currentSession?.title || '智能体' }}</span><small v-if="running">处理中</small></div>
        <IconButton icon="database" label="查询预设" :active="showQueries" @click="showQueries = !showQueries; refreshQueries()" />
        <IconButton icon="refresh" label="刷新对话" :disabled="busy" @click="refresh" />
        <IconButton icon="settings" label="配置智能体模型" @click="emit('settings')" />
      </header>
      <div v-if="error" class="agent-error-banner"><AgentErrorCard :message="error" @settings="emit('settings')" /><IconButton icon="close" label="关闭错误提示" @click="error = ''" /></div>
      <div v-if="showQueries" class="agent-query-list primary-scroll">
        <p v-if="!queries.length" class="amane-muted">暂无查询预设。可以让智能体查询片库并保存查询。</p>
        <article v-for="query in queries" :key="query.id" class="agent-query">
          <strong>{{ query.name }}</strong><p>{{ query.description }}</p>
          <details><summary>查询语句</summary><pre>{{ query.sql }}</pre></details>
          <div class="agent-query-actions">
            <button type="button" class="yb-btn-soft" :disabled="busy" @click="viewQuery(query.id)">查看结果</button>
            <button v-if="!query.persisted" type="button" class="yb-btn-soft" :disabled="busy" @click="queryAction(query.id, 'persist')">保留预设</button>
            <IconButton icon="trash" label="删除查询预设" danger :disabled="busy" @click="queryAction(query.id, 'delete')" />
          </div>
        </article>
        <div v-if="queryResult" class="agent-query-result">
          <div class="agent-query-actions"><span>共 {{ queryResult.total }} 行</span><IconButton icon="download" label="导出当前查询结果为 CSV" @click="exportQuery" /></div>
          <div class="amane-table-wrap"><table class="amane-table"><thead><tr><th v-for="column in queryResult.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, index) in queryResult.rows" :key="index"><td v-for="(value, cell) in row" :key="cell">{{ cellText(value) }}</td></tr></tbody></table></div>
          <div class="agent-query-actions"><button type="button" class="yb-btn-soft" :disabled="busy || queryOffset === 0" @click="viewQuery(queryId, queryOffset - 100)">上一页</button><button type="button" class="yb-btn-soft" :disabled="busy || queryOffset + 100 >= queryResult.total" @click="viewQuery(queryId, queryOffset + 100)">下一页</button></div>
        </div>
      </div>
      <div v-else ref="messageList" class="agent-message-list primary-scroll" role="log" aria-label="对话消息" :aria-busy="loadingTrace">
        <div class="agent-thread">
        <div v-if="loadingTrace" class="amane-muted" role="status">正在读取对话…</div>
        <div v-else-if="!folded.messages.length" class="agent-welcome"><AppIcon name="sparkle" size="lg" /><h2>想在片库中找什么？</h2><p>查询影片、演员和媒体文件，或让智能体帮你整理查询条件。</p><div class="agent-suggestions"><button v-for="hint in hints" :key="hint" type="button" class="yb-btn-soft" @click="draft = hint"><AppIcon name="search" size="sm" />{{ hint }}</button></div><p class="amane-muted">首次使用，请先在设置的「智能体」中配置模型。</p></div>
        <article v-for="message in folded.messages" :key="message.id" class="agent-message" :class="message.role">
          <span v-if="message.role === 'assistant'" class="agent-role"><AppIcon name="sparkle" size="sm" />Amane</span>
          <template v-for="(part, index) in message.parts" :key="index">
            <AgentMarkdown v-if="part.kind === 'text'" :text="part.text" />
            <details v-else-if="part.kind === 'reasoning'" class="agent-thought"><summary>思考过程</summary><AgentMarkdown :text="part.text" /></details>
            <details v-else-if="part.kind === 'tool'" class="agent-tool"><summary><AppIcon name="settings" size="sm" />{{ part.name }} <span>{{ part.result === undefined ? '等待结果' : '已完成' }}</span></summary><p>参数</p><pre>{{ cellText(part.args) }}</pre><template v-if="part.result !== undefined"><p>结果</p><pre>{{ cellText(part.result) }}</pre></template></details>
            <p v-else-if="part.kind === 'usage'" class="agent-usage">{{ part.text }}</p>
            <AgentErrorCard v-else :message="part.text" @settings="emit('settings')" />
          </template>
        </article>
        <p v-if="running" class="amane-muted" role="status">正在处理…</p>
        </div>
      </div>
      <div v-if="folded.interrupts.length && !showQueries" class="agent-approvals">
        <strong>以下操作需要你确认</strong>
        <div v-for="interrupt in folded.interrupts" :key="interrupt.id" class="agent-approval">
          <details><summary>{{ interrupt.reason || interrupt.toolCallId || '待确认操作' }}</summary><pre>{{ cellText(interrupt.value ?? interrupt) }}</pre></details>
          <button class="yb-btn-soft" type="button" :disabled="busy || running" :aria-pressed="decisions[interrupt.id] === true" @click="decisions[interrupt.id] = true">批准</button>
          <button class="yb-btn-soft" type="button" :disabled="busy || running" :aria-pressed="decisions[interrupt.id] === false" @click="decisions[interrupt.id] = false">拒绝</button>
        </div>
        <button class="yb-btn-primary" type="button" :disabled="busy || running || !allDecided" @click="resume">提交决定并继续</button>
      </div>
      <div v-if="!showQueries" class="agent-composer-dock">
      <form class="agent-composer" @submit.prevent="send">
        <textarea v-model="draft" rows="2" placeholder="向片库提问…" aria-label="输入消息" :disabled="busy || loadingTrace || running || !!folded.interrupts.length" @keydown="composerKey" />
        <div class="agent-composer-actions"><label>思考<select class="agent-thinking-select" aria-label="思考强度" :value="currentSession?.thinking || ''" :disabled="!selected || busy || running" @change="setThinking(($event.target as HTMLSelectElement).value)"><option value="">跟随全局设置</option><option v-for="mode in thinkingModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option></select></label><span>Enter 发送，Shift + Enter 换行</span><IconButton v-if="running" icon="stop" label="停止生成" :disabled="busy" @click="stop" /><IconButton v-else icon="arrowUp" label="发送消息" :disabled="busy || loadingTrace || !draft.trim() || !!folded.interrupts.length" @click="send" /></div>
      </form>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import IconButton from '@/components/IconButton.vue'
import { amaneRequest } from '@/api/amane'
import { agentPath, agentRunBody, foldAgentTrace, getTrace, type AgentSession, type AgentTrace, type SavedQuery, type QueryResult } from '@/api/amane-agent'
import AgentMarkdown from './AgentMarkdown.vue'
import AgentErrorCard from './AgentErrorCard.vue'
const emit = defineEmits<{ settings: [] }>()
const sessions = ref<AgentSession[]>([]), selected = ref<number | null>(null)
const trace = ref<AgentTrace>({ events: [], turn_running: false, last_seq: 0, meta: {} })
const draft = ref(''), error = ref(''), busy = ref(false), loadingTrace = ref(false), renaming = ref<number | null>(null), renameText = ref('')
const showQueries = ref(false), queries = ref<SavedQuery[]>([]), queryResult = ref<QueryResult | null>(null), queryId = ref(0), queryOffset = ref(0)
const decisions = reactive<Record<string, boolean>>({}), messageList = ref<HTMLElement | null>(null)
const thinkingModes = [{ value: 'off', label: '关闭' }, { value: 'minimal', label: '最低' }, { value: 'low', label: '较低' }, { value: 'medium', label: '中等' }, { value: 'high', label: '较高' }, { value: 'xhigh', label: '最高' }]
const hints = ['找出片库中评分最高的影片', '有哪些影片还没有关联本地文件？', '统计我的片库类型和发行年份']
const folded = computed(() => foldAgentTrace(trace.value.events)), running = computed(() => trace.value.turn_running)
const currentSession = computed(() => sessions.value.find(item => item.id === selected.value))
const allDecided = computed(() => folded.value.interrupts.every(item => Object.hasOwn(decisions, item.id)))
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, active = true, disposed = false
const drafts = new Map<number, string>()
const cellText = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
async function act(action: () => Promise<void>): Promise<void> { if (busy.value) return; busy.value = true; error.value = ''; try { await action() } catch (e) { if (!disposed) error.value = (e as Error).message } finally { busy.value = false } }
async function refreshSessions(): Promise<void> { const result = await amaneRequest<{ items: AgentSession[] }>('/agent/sessions'); if (!disposed) sessions.value = result.items }
async function refreshTrace(): Promise<void> {
  const id = selected.value, version = generation
  if (!id || !active || disposed) return
  const result = await getTrace(id)
  if (version !== generation || disposed || !active) return
  const element = messageList.value, follow = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 100
  const wasRunning = running.value
  trace.value = result
  await nextTick()
  if (follow && messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  if (wasRunning && !result.turn_running) { await refreshSessions(); await refreshQueries() }
}
function schedule(): void { clearTimeout(timer); if (active && !disposed) timer = setTimeout(async () => { try { await refreshTrace() } catch (e) { if (!disposed) error.value = (e as Error).message } finally { schedule() } }, running.value ? 1000 : 6000) }
async function selectSession(id: number): Promise<void> {
  if (disposed || busy.value || selected.value === id) return
  if (selected.value) drafts.set(selected.value, draft.value)
  generation++; clearTimeout(timer); selected.value = id; draft.value = drafts.get(id) || ''; loadingTrace.value = true
  trace.value = { events: [], turn_running: false, last_seq: 0, meta: {} }; error.value = ''; for (const key of Object.keys(decisions)) delete decisions[key]
  const version = generation
  try { await refreshTrace() } catch (e) { if (generation === version) error.value = (e as Error).message } finally { if (version === generation) loadingTrace.value = false; schedule() }
}
async function createSession(): Promise<void> { await act(async () => { const result = await amaneRequest<AgentSession>('/agent/sessions', 'POST', {}); await refreshSessions(); if (selected.value) drafts.set(selected.value, draft.value); generation++; selected.value = result.id; draft.value = ''; trace.value = { events: [], turn_running: false, last_seq: 0, meta: {} }; showQueries.value = false; schedule() }) }
async function renameSession(id: number): Promise<void> { if (!renameText.value.trim()) return; await act(async () => { await amaneRequest(agentPath(id), 'PATCH', { title: renameText.value.trim() }); renaming.value = null; await refreshSessions() }) }
async function deleteSession(session: AgentSession): Promise<void> { if (!window.confirm(`删除对话“${session.title}”？此操作无法撤销。`)) return; await act(async () => { await amaneRequest(agentPath(session.id), 'DELETE'); drafts.delete(session.id); if (selected.value === session.id) { generation++; selected.value = null; trace.value = { events: [], turn_running: false, last_seq: 0, meta: {} }; draft.value = '' }; await refreshSessions() }) }
async function refresh(): Promise<void> { await act(async () => { await refreshSessions(); await refreshTrace() }) }
async function send(): Promise<void> {
  if (!draft.value.trim() || busy.value || loadingTrace.value || running.value || folded.value.interrupts.length) return
  const prompt = draft.value.trim()
  await act(async () => {
    if (!selected.value) { const session = await amaneRequest<AgentSession>('/agent/sessions', 'POST', {}); selected.value = session.id; generation++; await refreshSessions() }
    const id = selected.value!, first = !trace.value.events.some(row => row.type === 'user_message')
    await amaneRequest(agentPath(id) + '/agui', 'POST', agentRunBody(id, trace.value.events, prompt))
    draft.value = ''; drafts.delete(id)
    await refreshTrace(); schedule()
    if (first) void amaneRequest(agentPath(id) + '/title', 'POST', { prompt: prompt.slice(0, 4000) }).then(refreshSessions).catch(() => {})
  })
}
async function resume(): Promise<void> { if (!selected.value || !allDecided.value) return; await act(async () => { const id = selected.value!; const responses = Object.fromEntries(folded.value.interrupts.map(item => [item.id, decisions[item.id]])); await amaneRequest(agentPath(id) + '/agui', 'POST', agentRunBody(id, trace.value.events, undefined, responses)); await refreshTrace(); schedule() }) }
async function stop(): Promise<void> { if (selected.value) await act(async () => { await amaneRequest(agentPath(selected.value!) + '/agui/cancel', 'POST'); await refreshTrace() }) }
async function setThinking(thinking: string): Promise<void> { if (selected.value) await act(async () => { await amaneRequest(agentPath(selected.value!), 'PATCH', { thinking: thinking || null }); await refreshSessions() }) }
function composerKey(event: KeyboardEvent): void { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send() } }
async function refreshQueries(): Promise<void> { try { const result = await amaneRequest<{ items: SavedQuery[] }>('/saved-queries'); if (!disposed) queries.value = result.items } catch (e) { if (showQueries.value && !disposed) error.value = (e as Error).message } }
async function queryAction(id: number, action: 'persist' | 'delete'): Promise<void> { if (action === 'delete' && !window.confirm('删除此查询预设？')) return; await act(async () => { await amaneRequest('/saved-queries/batch', 'POST', { ids: [id], action }); if (action === 'delete' && queryId.value === id) queryResult.value = null; await refreshQueries() }) }
async function viewQuery(id: number, offset = 0): Promise<void> { await act(async () => { queryResult.value = await amaneRequest<QueryResult>(`/saved-queries/${id}/result?offset=${offset}&limit=100`); queryId.value = id; queryOffset.value = offset }) }
function exportQuery(): void { if (!queryResult.value) return; const quote = (value: unknown): string => '"' + cellText(value).replace(/"/g, '""').replace(/^[=+@-]/, "'$&") + '"'; const rows = [queryResult.value.columns, ...queryResult.value.rows].map(row => row.map(quote).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob(['\ufeff' + rows], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `amane-query-${queryId.value}-page-${queryOffset.value / 100 + 1}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
onMounted(async () => { loadingTrace.value = true; try { await refreshSessions(); if (!disposed && sessions.value[0]) await selectSession(sessions.value[0].id) } catch (e) { if (!disposed) error.value = (e as Error).message } finally { loadingTrace.value = false; schedule() } })
onActivated(() => { active = true; schedule() })
onDeactivated(() => { active = false; generation++; loadingTrace.value = false; clearTimeout(timer) })
onBeforeUnmount(() => { disposed = true; active = false; generation++; clearTimeout(timer) })
</script>
<style src="./agent.css"></style>
