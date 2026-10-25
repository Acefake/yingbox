import type {
  AiChatRequest,
  AiChatResult,
  AiDeltaEvent,
  AiJsonRequest,
  AiJsonResult,
  AiMessage,
  AiTestResult,
  AiUsageSummary,
} from '../ai/types'
import { ContractError, call, defineDomain, event, record, str } from './define'

/** 单次请求里全部消息的总长度上限（字符） */
const MAX_TOTAL_CHARS = 2_000_000
/** 消息条数上限 */
const MAX_MESSAGES = 500
const ROLES: readonly AiMessage['role'][] = ['system', 'user', 'assistant']

/** 校验并规范化对话请求（只保留认识的字段） */
export function parseChatRequest(raw: unknown): AiChatRequest {
  const input = record<Record<string, unknown>>(raw, 'request')
  if (!Array.isArray(input.messages) || input.messages.length === 0)
    throw new ContractError('参数 request.messages 应为非空数组')
  if (input.messages.length > MAX_MESSAGES)
    throw new ContractError(`消息不能超过 ${MAX_MESSAGES} 条`)
  let total = 0
  const messages = input.messages.map((item, index): AiMessage => {
    const m = record<Record<string, unknown>>(item, `messages[${index}]`)
    if (!ROLES.includes(m.role as AiMessage['role']))
      throw new ContractError(`参数 messages[${index}].role 不合法`)
    const content = str(m.content, `messages[${index}].content`)
    total += content.length
    return { role: m.role as AiMessage['role'], content }
  })
  if (total > MAX_TOTAL_CHARS) throw new ContractError('消息内容过长')
  const request: AiChatRequest = { messages }
  const optNum = (
    key: string,
    min: number,
    max: number
  ): number | undefined => {
    const value = input[key]
    if (value == null) return undefined
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new ContractError(`参数 ${key} 应在 ${min}–${max} 之间`)
    return value
  }
  if (typeof input.model === 'string' && input.model.trim())
    request.model = input.model.trim().slice(0, 200)
  request.temperature = optNum('temperature', 0, 2)
  request.maxTokens = optNum('maxTokens', 1, 1_000_000)
  request.timeoutMs = optNum('timeoutMs', 1000, 30 * 60_000)
  if (input.private === true) request.private = true
  if (input.localOnly === true) {
    request.localOnly = true
    request.private = true
  }
  if (typeof input.sessionId === 'string' && input.sessionId.trim())
    request.sessionId = input.sessionId.trim().slice(0, 100)
  if (input.stream === true) request.stream = true
  if (typeof input.requestId === 'string' && input.requestId)
    request.requestId = input.requestId.slice(0, 100)
  if (request.stream && !request.requestId)
    throw new ContractError('流式请求需要 requestId')
  for (const key of ['temperature', 'maxTokens', 'timeoutMs'] as const)
    if (request[key] === undefined) delete request[key]
  return request
}

/** 校验结构化输出请求 */
export function parseJsonRequest(raw: unknown): AiJsonRequest {
  const input = record<Record<string, unknown>>(raw, 'request')
  // 结构化输出不走流式：忽略 stream
  const request: AiJsonRequest = parseChatRequest({ ...input, stream: false })
  if (input.schema != null)
    request.schema = record<Record<string, unknown>>(input.schema, 'schema')
  if (
    typeof input.schemaName === 'string' &&
    /^[\w-]{1,64}$/.test(input.schemaName)
  )
    request.schemaName = input.schemaName
  return request
}

/**
 * AI：OpenAI 兼容模型的统一调用入口（实现见 src/main/ai）。
 * API Key 不经这里：渲染层用 settings.setSecret('ai.apiKey.<服务商>') 只写不读。
 * 错误信息带 `[ai:<code>]` 前缀（见 shared/ai/types 的 parseAiErrorMessage）。
 */
export const ai = defineDomain(
  'ai',
  {
    /** 对话。stream 为 true 时增量经 delta 事件推给发起窗口，最终仍返回完整结果 */
    chat: call<[request: AiChatRequest], AiChatResult>(a => [
      parseChatRequest(a[0]),
    ]),
    /** 结构化输出：JSON 模式 / json_schema，容错解析后返回 data */
    chatJson: call<[request: AiJsonRequest], AiJsonResult>(a => [
      parseJsonRequest(a[0]),
    ]),
    /** 取消本窗口发起的请求；返回是否找到并取消 */
    cancel: call<[requestId: string], boolean>(a => [str(a[0], 'requestId')]),
    /** 用当前设置发一条最短对话测试连通性（失败也正常返回） */
    testConnection: call<AiTestResult>(),
    /** 本月及最近几个月的 tokens 用量 */
    usage: call<AiUsageSummary>(),
  },
  {
    /** 流式增量（只发给发起请求的窗口） */
    delta: event<AiDeltaEvent>(),
    /** 用量变化（每次成功调用后广播） */
    usageChanged: event<AiUsageSummary>(),
  }
)
