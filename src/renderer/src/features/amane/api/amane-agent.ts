import { amaneRequest } from './amane'
export interface AgentSession { id: number; title: string; status: string; thinking: string | null; updated_at: string }
interface AgentInterrupt { id: string; toolCallId?: string; value?: unknown; reason?: string }
export interface TraceRow { type: string; text?: string; block_id?: string; tool_call_id?: string; name?: string; args?: unknown; result?: unknown; message?: string; usage?: Record<string, number>; interrupts?: AgentInterrupt[] }
export interface AgentTrace { events: TraceRow[]; turn_running: boolean; last_seq: number; meta: Record<string, unknown> }
interface AgentPart { kind: 'text' | 'reasoning' | 'tool' | 'usage' | 'error'; text: string; id?: string; name?: string; args?: unknown; result?: unknown }
interface AgentMessage { id: string; role: 'user' | 'assistant'; parts: AgentPart[] }
export interface SavedQuery { id: number; name: string; description: string; sql: string; entity: string; persisted: boolean }
export interface QueryResult { columns: string[]; rows: unknown[][]; total: number; offset: number; limit: number }
export function foldAgentTrace(rows: TraceRow[]): { messages: AgentMessage[]; interrupts: AgentInterrupt[] } {
  const messages: AgentMessage[] = []; let interrupts: AgentInterrupt[] = []
  let assistant: AgentMessage | undefined
  const blocks = new Map<string, AgentPart>()
  const ensure = (): AgentMessage => { if (!assistant) { assistant = { id: `a-${messages.length}`, role: 'assistant', parts: [] }; messages.push(assistant) } return assistant }
  for (const row of rows) {
    if (row.type === 'user_message') { messages.push({ id: `u-${messages.length}`, role: 'user', parts: [{ kind: 'text', text: row.text || '' }] }); assistant = undefined; blocks.clear() }
    else if (row.type === 'text_delta' || row.type === 'reasoning_delta') {
      const kind = row.type === 'text_delta' ? 'text' : 'reasoning', key = `${kind}:${row.block_id}`
      let part = blocks.get(key)
      if (!part) { part = { kind, text: '' }; blocks.set(key, part); ensure().parts.push(part) }
      part.text += row.text || ''
    } else if (row.type === 'tool_call') {
      const part: AgentPart = { kind: 'tool', id: row.tool_call_id, name: row.name, args: row.args, text: '' }
      blocks.set(`tool:${row.tool_call_id}`, part); ensure().parts.push(part)
    } else if (row.type === 'tool_result') {
      const part = blocks.get(`tool:${row.tool_call_id}`); if (part) part.result = row.result
    } else if (row.type === 'turn_usage' || row.type === 'request_usage') {
      const u = row.usage || {}; ensure().parts.push({ kind: 'usage', text: `${row.type === 'turn_usage' ? '本轮' : '本次请求'}：输入 ${u.input || 0} / 输出 ${u.output || 0} / 缓存读取 ${u.cache_read || 0}${u.requests ? ` / ${u.requests} 次请求` : ''}` })
    } else if (row.type === 'approvals') interrupts = row.interrupts || []
    else if (row.type === 'error') { ensure().parts.push({ kind: 'error', text: row.message || '运行失败' }); assistant = undefined }
    else if (row.type === 'cancelled') { ensure().parts.push({ kind: 'text', text: '已停止生成' }); assistant = undefined }
  }
  return { messages, interrupts }
}
const createId = (): string => typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
export function agentRunBody(id: number, rows: TraceRow[], prompt?: string, decisions?: Record<string, boolean>): Record<string, unknown> {
  const messages = rows.filter(row => row.type === 'user_message').map((row, index) => ({ id: `u-${index}`, role: 'user', content: row.text || '' }))
  if (prompt) messages.push({ id: createId(), role: 'user', content: prompt })
  return { threadId: `session-${id}`, runId: createId(), state: null, messages, tools: [], context: [], forwardedProps: {}, ...(decisions ? { resume: Object.entries(decisions).map(([interruptId, approved]) => ({ interruptId, status: 'resolved', payload: approved ? { approved: true } : { approved: false, reason: '用户拒绝此操作' } })) } : {}) }
}
export const agentPath = (id: number): string => `/agent/sessions/${id}`
export const getTrace = (id: number): Promise<AgentTrace> => amaneRequest(`${agentPath(id)}/trace`)
