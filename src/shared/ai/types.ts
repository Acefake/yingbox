/**
 * AI 基础层的共享类型：主进程（src/main/ai）、IPC 契约（contract/ai）与渲染层（features/ai）共用。
 *
 * 所有 AI 功能（AI 字幕、刮削兜底、自然语言搜索、今晚看什么、前情提要）都只经这里的请求 / 结果形状
 * 调用模型，不关心具体服务商。本文件被 sandboxed preload 间接打包，只能是纯 TS。
 */

/** 服务商预设 */
export type AiProviderId =
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'opencode-go'
  | 'ollama'
  | 'custom'

/** 对话消息（OpenAI Chat Completions 格式的子集） */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 一次对话请求 */
export interface AiChatRequest {
  /** 消息列表（至少一条） */
  messages: AiMessage[]
  /** 覆盖设置里的对话模型；省略用设置 / 预设默认值 */
  model?: string
  /** 采样温度 0–2 */
  temperature?: number
  /** 最多生成多少 tokens */
  maxTokens?: number
  /**
   * 内容来自私密板块。设置「私密板块只用本地模型」打开（默认）时，
   * 非本地服务商直接拒绝（错误码 private_blocked），请求不会发出。
   */
  private?: boolean
  /**
   * 只发给本地模型，不看「私密板块只用本地模型」的设置：非本地服务商一律拒绝（private_blocked）。
   * 给出时同时视为 private。
   */
  localOnly?: boolean
  /**
   * 同一段对话的稳定标识（多轮问答共用一个）。目前只有 OpenCode Go 用它做路由与缓存
   * （x-opencode-session 头）；省略时用本次运行的标识。
   */
  sessionId?: string
  /** 总超时（毫秒，默认 60 秒，流式默认 120 秒） */
  timeoutMs?: number
  /**
   * 流式输出：渲染层给一个唯一 requestId，主进程把增量经 ai.onDelta 推给发起窗口；
   * 同一个 requestId 可用 ai.cancel 取消。
   */
  stream?: boolean
  /** 请求标识（流式或需要取消时必填） */
  requestId?: string
}

/** 结构化输出请求：返回 JSON */
export interface AiJsonRequest extends Omit<AiChatRequest, 'stream'> {
  /**
   * 可选 JSON Schema：支持 json_schema 的服务商（OpenAI / OpenRouter）按 schema 约束输出，
   * 其余服务商用 JSON 模式并把 schema 附在系统提示里。
   */
  schema?: Record<string, unknown>
  /** schema 名称（json_schema 要求；默认 result） */
  schemaName?: string
}

/** 一次调用的 token 用量（服务商返回的 usage） */
export interface AiTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 对话结果 */
export interface AiChatResult {
  /** 模型输出的文本 */
  content: string
  /** 实际使用的模型 */
  model: string
  /** 服务商 */
  provider: AiProviderId
  /** 结束原因（stop / length / …），服务商没给时为空串 */
  finishReason: string
  /** token 用量；服务商没返回时为 null */
  usage: AiTokenUsage | null
}

/** 结构化输出结果 */
export interface AiJsonResult<T = unknown> extends AiChatResult {
  /** 解析后的 JSON */
  data: T
}

/** 流式增量事件 */
export interface AiDeltaEvent {
  requestId: string
  /** 新增的文本片段 */
  delta: string
}

/** 测试连接的结果（失败也正常返回，不抛错） */
export interface AiTestResult {
  ok: boolean
  provider: AiProviderId
  model: string
  /** 往返耗时（毫秒） */
  latencyMs: number
  /** 失败时的错误码与说明 */
  code?: AiErrorCode
  message?: string
}

/** 某个月的累计用量 */
export interface AiMonthUsage {
  /** 月份 YYYY-MM（本地时间） */
  month: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 成功的请求数（含没返回 usage 的） */
  requests: number
}

/** 用量概览：本月 + 最近几个月（新到旧） */
export interface AiUsageSummary {
  current: AiMonthUsage
  history: AiMonthUsage[]
}

/** 错误码：渲染层据此决定提示文案或降级 */
export type AiErrorCode =
  /** 没配置 Key / 模型 / 接口地址 */
  | 'not_configured'
  /** 私密内容 + 非本地服务商 */
  | 'private_blocked'
  /** 服务商返回 HTTP 错误（401/429/5xx…） */
  | 'http'
  /** 超时 */
  | 'timeout'
  /** 调用方取消 */
  | 'cancelled'
  /** 网络不通 */
  | 'network'
  /** 响应不是预期格式 */
  | 'bad_response'
  /** 要求 JSON 但解析失败 */
  | 'bad_json'

/** 全部错误码 */
export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'not_configured',
  'private_blocked',
  'http',
  'timeout',
  'cancelled',
  'network',
  'bad_response',
  'bad_json',
]

/**
 * 错误跨 IPC 只剩 message，错误码编码在前缀里：`[ai:<code>] 说明`。
 * 主进程抛出时生成，渲染层 {@link parseAiErrorMessage} 还原。
 */
export function formatAiErrorMessage(
  code: AiErrorCode,
  message: string
): string {
  return `[ai:${code}] ${message}`
}

/** 从（可能被 Electron 包了一层的）错误信息里取回错误码与说明 */
export function parseAiErrorMessage(
  text: string
): { code: AiErrorCode; message: string } | null {
  const match = /\[ai:([a-z_]+)\] ([\s\S]*)$/.exec(text)
  if (!match) return null
  const code = match[1] as AiErrorCode
  if (!AI_ERROR_CODES.includes(code)) return null
  return { code, message: match[2] }
}
