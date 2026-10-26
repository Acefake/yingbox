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
import { AiError, httpError } from './errors'
import { readJson, readStream } from './read'
import { rawSnippet } from './response'

export { toUsage } from './read'

/** 注入的 fetch（Response 只用到标准字段） */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** JSON 输出要求 */
export interface JsonOutput {
  schema?: Record<string, unknown>
  schemaName?: string
  /**
   * 只靠提示词要 JSON，不发 response_format。服务商不认 response_format（400）时
   * {@link chatCompletion} 自动降级成这一档。
   */
  promptOnly?: boolean
}

/** 客户端结果：在对外结果之外带上思考与工具调用参数（只在主进程里用，service 返回前去掉） */
export interface ClientResult extends AiChatResult {
  /** 思考过程（reasoning_content / reasoning） */
  reasoning: string
  /** 第一个工具调用的参数文本 */
  toolArgs: string
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
 * 思考型模型的额外额度：思考计入 max_tokens，调用方按「回答多长」给的小额度（如 300）
 * 常被思考用光，content 为空、finish_reason 为 length。这时补上这么多再请求一次。
 */
export const REASONING_HEADROOM_TOKENS = 4096

/** JSON 调用的最低 max_tokens：JSON 本身很短，给足余量让思考型模型想完再输出 */
export const JSON_MIN_TOKENS = 2048

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
  const json = options.json
  if (request.maxTokens !== undefined)
    body.max_tokens = json
      ? Math.max(request.maxTokens, JSON_MIN_TOKENS)
      : request.maxTokens
  if (options.stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  if (json) {
    if (json.schema && config.jsonSchema && !json.promptOnly) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: json.schemaName || 'result',
          schema: json.schema,
          strict: true,
        },
      }
    } else {
      if (!json.promptOnly) body.response_format = { type: 'json_object' }
      // JSON 模式要求提示里出现 "JSON"；没有 schema 能力时把 schema 写进系统提示
      const hint = json.schema
        ? `只输出符合下面 JSON Schema 的 JSON，不要任何解释：\n${JSON.stringify(json.schema)}`
        : '只输出 JSON，不要任何解释。'
      messages.unshift({ role: 'system', content: hint })
    }
  }
  return body
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

/** 服务商不认 response_format / JSON 模式时的 400 说明 */
const JSON_MODE_UNSUPPORTED =
  /response_format|json_schema|json_object|json mode|structured output/i

/** 两次用量相加（扩额重试时把第一次的思考也记上） */
function sumUsage(
  a: AiTokenUsage | null,
  b: AiTokenUsage | null
): AiTokenUsage | null {
  if (!a || !b) return a ?? b
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

/** 额度被思考用光：没有正文也没有工具调用，结束原因是 length */
export function spentOnReasoning(result: ClientResult): boolean {
  return (
    result.finishReason === 'length' &&
    !result.content.trim() &&
    !result.toolArgs.trim()
  )
}

/**
 * 发一次对话（含重试）；成功返回结果，失败抛 AiError。
 *
 * 除了网络 / 5xx 重试，还有两种自动补救（各最多一次）：
 * - 思考型模型把 max_tokens 用光、没有正文：补 {@link REASONING_HEADROOM_TOKENS} 再请求，仍没有正文抛 truncated；
 * - 要 JSON 时服务商 400 说不支持 response_format：去掉它、只靠提示词再请求。
 */
export async function chatCompletion(
  config: AiConfig,
  request: AiChatRequest,
  options: ClientOptions
): Promise<ClientResult> {
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
  let current = request
  let json = options.json
  let expanded: ClientResult | null = null
  for (let attempt = 0; ; ) {
    try {
      const result = await attemptOnce(config, current, {
        ...options,
        json,
        onDelta,
      })
      const usage = sumUsage(expanded?.usage ?? null, result.usage)
      if (!spentOnReasoning(result)) return { ...result, usage }
      if (expanded)
        throw new AiError(
          'truncated',
          `模型把输出额度都用在了思考上，没有给出回答（思考开头：${rawSnippet(result.reasoning, 120)}）`
        )
      expanded = { ...result, usage }
      const budget = current.maxTokens ?? 0
      current = {
        ...current,
        maxTokens:
          Math.max(budget, json ? JSON_MIN_TOKENS : 0) +
          REASONING_HEADROOM_TOKENS,
      }
      continue
    } catch (error) {
      const err =
        error instanceof AiError ? error : new AiError('network', String(error))
      if (
        json &&
        !json.promptOnly &&
        err.code === 'http' &&
        (err.status === 400 || err.status === 422) &&
        JSON_MODE_UNSUPPORTED.test(err.message)
      ) {
        json = { ...json, promptOnly: true }
        continue
      }
      if (!err.retryable || emitted || attempt >= retries || outer.aborted)
        throw err
      const wait = Math.min(
        err.retryAfterMs ?? baseDelay * 2 ** attempt,
        10_000
      )
      attempt++
      await sleep(wait, outer)
    }
  }
}

/** 单次请求：超时与外部取消合并到一个 AbortController */
async function attemptOnce(
  config: AiConfig,
  request: AiChatRequest,
  options: ClientOptions
): Promise<ClientResult> {
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
