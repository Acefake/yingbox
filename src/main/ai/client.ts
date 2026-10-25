/**
 * OpenAI 兼容 Chat Completions 客户端：请求构造、非流式 / 流式（SSE）、超时、重试、取消。
 *
 * 不依赖 Electron：fetch 由调用方注入（主进程传 net.fetch，走系统代理；测试传 mock）。
 * 重试只针对 408 / 409 / 429 / 5xx 与网络错误，指数退避（尊重 Retry-After，最多等 10 秒）；
 * 流式已经推出过增量后不再重试，避免调用方收到重复文本。
 */
import type {
  AiChatRequest,
  AiChatResult,
  AiTokenUsage,
} from '../../shared/ai/types'
import type { AiConfig } from './config'
import { AiError, httpError, streamError } from './errors'
import { type StreamChunk, createSseParser } from './sse'

/** 注入的 fetch（Response 只用到标准字段） */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** JSON 输出要求 */
export interface JsonOutput {
  schema?: Record<string, unknown>
  schemaName?: string
}

/** 发请求的依赖与选项 */
export interface ClientOptions {
  fetch: FetchLike
  /** 外部取消 */
  signal?: AbortSignal
  /** 流式增量回调；传入即走流式 */
  onDelta?: (delta: string) => void
  /** 要求 JSON 输出 */
  json?: JsonOutput
  /** 最多重试几次（默认 2） */
  retries?: number
  /** 第一次重试前等待（毫秒，默认 800，之后翻倍） */
  retryDelayMs?: number
  /** 可替换的等待函数（测试用） */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** 默认超时 */
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_STREAM_TIMEOUT_MS = 120_000

/**
 * 本次运行的会话标识：OpenCode Go 要求每段对话带稳定的 x-opencode-session
 * （缺了返回 400），用于路由与提示缓存。调用方没给会话时整个进程共用这一个。
 */
const RUN_SESSION = globalThis.crypto.randomUUID()

/**
 * 请求头：Bearer Key（有才带）+ OpenRouter 来源标识 + OpenCode Go 的 User-Agent 与会话头。
 * sessionId 是同一段对话的稳定标识（如问剧情的一次会话）；省略时用本次运行的标识。
 */
export function buildHeaders(
  config: AiConfig,
  stream: boolean,
  sessionId?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/Acefake/yingbox'
    headers['X-Title'] = 'yingbox'
  }
  if (config.provider === 'opencode-go') {
    headers['User-Agent'] = 'yingbox'
    headers['x-opencode-session'] =
      `yingbox-${sessionId?.trim() || RUN_SESSION}`
  }
  return headers
}

/** 请求体：Chat Completions 字段，按需加流式用量、JSON 模式 / json_schema */
export function buildChatBody(
  config: AiConfig,
  request: AiChatRequest,
  options: { stream: boolean; json?: JsonOutput }
): Record<string, unknown> {
  const messages = request.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))
  const body: Record<string, unknown> = {
    model: request.model?.trim() || config.model,
    messages,
  }
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  if (options.stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  const json = options.json
  if (json) {
    if (json.schema && config.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: json.schemaName || 'result',
          schema: json.schema,
          strict: true,
        },
      }
    } else {
      body.response_format = { type: 'json_object' }
      // JSON 模式要求提示里出现 "JSON"；没有 schema 能力时把 schema 写进系统提示
      const hint = json.schema
        ? `只输出符合下面 JSON Schema 的 JSON，不要任何解释：\n${JSON.stringify(json.schema)}`
        : '只输出 JSON，不要任何解释。'
      messages.unshift({ role: 'system', content: hint })
    }
  }
  return body
}

/** 服务商 usage → 统一字段 */
export function toUsage(raw: StreamChunk['usage']): AiTokenUsage | null {
  if (!raw) return null
  const prompt = Number(raw.prompt_tokens) || 0
  const completion = Number(raw.completion_tokens) || 0
  const total = Number(raw.total_tokens) || prompt + completion
  if (!prompt && !completion && !total) return null
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  }
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AiError('cancelled', '已取消'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new AiError('cancelled', '已取消'))
      },
      { once: true }
    )
  })

/** 发一次对话（含重试）；成功返回结果，失败抛 AiError */
export async function chatCompletion(
  config: AiConfig,
  request: AiChatRequest,
  options: ClientOptions
): Promise<AiChatResult> {
  const retries = options.retries ?? 2
  const baseDelay = options.retryDelayMs ?? 800
  const sleep = options.sleep ?? abortableSleep
  const outer = options.signal ?? new AbortController().signal
  let emitted = false
  const onDelta = options.onDelta
    ? (delta: string): void => {
        emitted = true
        options.onDelta?.(delta)
      }
    : undefined
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(config, request, { ...options, onDelta })
    } catch (error) {
      const err =
        error instanceof AiError ? error : new AiError('network', String(error))
      if (!err.retryable || emitted || attempt >= retries || outer.aborted)
        throw err
      const wait = Math.min(
        err.retryAfterMs ?? baseDelay * 2 ** attempt,
        10_000
      )
      await sleep(wait, outer)
    }
  }
}

/** 单次请求：超时与外部取消合并到一个 AbortController */
async function attemptOnce(
  config: AiConfig,
  request: AiChatRequest,
  options: ClientOptions
): Promise<AiChatResult> {
  const stream = Boolean(options.onDelta)
  const timeoutMs =
    request.timeoutMs ??
    (stream ? DEFAULT_STREAM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const fail = (error: unknown): AiError => {
    if (error instanceof AiError) return error
    if (timedOut)
      return new AiError(
        'timeout',
        `AI 请求超过 ${Math.round(timeoutMs / 1000)} 秒没有完成`,
        {
          retryable: true,
        }
      )
    if (controller.signal.aborted) return new AiError('cancelled', '已取消')
    return new AiError(
      'network',
      `连不上 AI 接口：${(error as Error)?.message ?? error}`,
      {
        retryable: true,
      }
    )
  }
  try {
    const response = await options.fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config, stream, request.sessionId),
      body: JSON.stringify(
        buildChatBody(config, request, { stream, json: options.json })
      ),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw httpError(
        response.status,
        text,
        response.headers.get('retry-after')
      )
    }
    return stream
      ? await readStream(config, request, response, options.onDelta!)
      : await readJson(config, request, response)
  } catch (error) {
    throw fail(error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** 非流式响应 */
async function readJson(
  config: AiConfig,
  request: AiChatRequest,
  response: Response
): Promise<AiChatResult> {
  let body: {
    model?: string
    choices?: Array<{
      message?: { content?: unknown }
      finish_reason?: string | null
    }>
    usage?: StreamChunk['usage']
  }
  try {
    body = (await response.json()) as typeof body
  } catch {
    throw new AiError('bad_response', 'AI 接口返回的不是 JSON')
  }
  const choice = body.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string')
    throw new AiError('bad_response', 'AI 接口的响应里没有回答内容')
  return {
    content,
    model: body.model || request.model || config.model,
    provider: config.provider,
    finishReason: choice?.finish_reason ?? '',
    usage: toUsage(body.usage),
  }
}

/** 流式响应：逐块解析 SSE，增量回调，结束时汇总；流里出现 error 事件立即抛 AiError，不返回部分内容 */
async function readStream(
  config: AiConfig,
  request: AiChatRequest,
  response: Response,
  onDelta: (delta: string) => void
): Promise<AiChatResult> {
  if (!response.body) throw new AiError('bad_response', 'AI 接口没有返回流')
  let content = ''
  let model = ''
  let finishReason = ''
  let usage: AiTokenUsage | null = null
  const parser = createSseParser({
    onChunk: chunk => {
      if (chunk.error) throw streamError(chunk.error)
      if (chunk.model) model = chunk.model
      const choice = chunk.choices?.[0]
      const delta = choice?.delta?.content
      if (typeof delta === 'string' && delta) {
        content += delta
        onDelta(delta)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      usage = toUsage(chunk.usage) ?? usage
    },
    onDone: () => {},
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
  } catch (error) {
    reader.cancel().catch(() => {})
    throw error
  }
  return {
    content,
    model: model || request.model || config.model,
    provider: config.provider,
    finishReason,
    usage,
  }
}
