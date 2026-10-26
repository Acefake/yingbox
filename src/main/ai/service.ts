/**
 * AI 服务：所有 AI 功能（渲染层经 IPC，或主进程里的 AI 字幕等模块直接调用）的唯一入口。
 *
 * 每次调用都重新读设置（改了服务商 / 模型立即生效），依次做：配置检查 → 私密检查 → 发请求 → 记用量。
 * 结构化输出与测试连接是短调用，请求低推理强度（{@link QUICK_REASONING}）；chat 的长回答用模型默认。
 * 不依赖 Electron：设置读取、fetch、用量存储都由 index.ts 注入，测试可全部替换。
 */
import type { AiKeySecret } from '../../shared/ai/providers'
import type {
  AiChatRequest,
  AiChatResult,
  AiJsonRequest,
  AiJsonResult,
  AiTestResult,
  AiUsageSummary,
} from '../../shared/ai/types'
import {
  type ClientOptions,
  type ClientResult,
  type FetchLike,
  chatCompletion,
} from './client'
import {
  type AiConfig,
  type AiSettingValues,
  type AiSpeechConfig,
  assertPrivacy,
  assertUsable,
  resolveAiConfig,
  resolveSpeechConfig,
} from './config'
import { AiError } from './errors'
import { parseJsonLoose, parseLastJson } from './json'
import type { ReasoningEffort } from './params'
import { rawSnippet } from './response'
import type { UsageStore } from './usage'

/** 服务读取的设置 */
export interface AiServiceSettings {
  chat(): AiSettingValues
  privateLocalOnly(): boolean
  speech(): Parameters<typeof resolveSpeechConfig>[0]
  secret(key: AiKeySecret): string
}

/** 服务依赖 */
export interface AiServiceDeps {
  settings: AiServiceSettings
  fetch: FetchLike
  usage: UsageStore
  /** 用量变化后通知（广播给窗口） */
  onUsage?: (summary: AiUsageSummary) => void
  /** 客户端选项覆盖（测试用：重试间隔、sleep、参数记忆） */
  client?: Pick<ClientOptions, 'retries' | 'retryDelayMs' | 'sleep' | 'params'>
}

/** 单次调用的选项 */
export interface AiCallOptions {
  signal?: AbortSignal
  /** 流式增量（传入即走流式） */
  onDelta?: (delta: string) => void
}

/** AI 服务 */
export interface AiService {
  /** 当前生效的对话配置（含明文 Key，只给主进程模块用） */
  config(): AiConfig
  /** 当前语音识别配置（AI 字幕用） */
  speechConfig(): AiSpeechConfig
  chat(request: AiChatRequest, options?: AiCallOptions): Promise<AiChatResult>
  chatJson<T = unknown>(
    request: AiJsonRequest,
    options?: Omit<AiCallOptions, 'onDelta'> & {
      validate?: (data: unknown) => data is T
    }
  ): Promise<AiJsonResult<T>>
  testConnection(): Promise<AiTestResult>
  usage(): Promise<AiUsageSummary>
}

/** 去掉只在主进程里用的思考 / 工具调用字段 */
function publicResult(result: ClientResult): AiChatResult {
  const { reasoning: _r, toolArgs: _t, ...rest } = result
  return rest
}

/** 一次调用的原始返回（日志与错误说明用）：正文，没有正文时是工具调用参数或思考 */
function rawOutput(result: ClientResult): string {
  return result.content.trim() || result.toolArgs.trim() || result.reasoning
}

/** 从一次返回里取 JSON：正文 → 工具调用参数 → 思考过程里最后一个 JSON 对象 */
export function parseModelJson(result: ClientResult): unknown {
  if (result.content.trim()) return parseJsonLoose(result.content)
  if (result.toolArgs.trim()) return parseJsonLoose(result.toolArgs)
  return result.reasoning.trim() ? parseLastJson(result.reasoning) : undefined
}

/**
 * 短调用（意图识别、JSON 小结果、测试连接）的推理强度：思考型模型想得少、答得快；
 * 服务商 / 模型不认时客户端自动去掉（见 params.ts）。
 */
export const QUICK_REASONING: ReasoningEffort = 'low'

/** JSON 第一次没解析出来时，追加的纠正提示 */
export const JSON_REPAIR_HINT =
  '上面的输出不符合要求。只输出一个符合要求的 JSON 对象：不要解释、不要代码块、不要思考过程。'

/** 创建 AI 服务 */
export function createAiService(deps: AiServiceDeps): AiService {
  const config = (): AiConfig =>
    resolveAiConfig(deps.settings.chat(), key => deps.settings.secret(key))

  const run = async (
    request: AiChatRequest,
    options: AiCallOptions & {
      json?: ClientOptions['json']
      retries?: number
      reasoning?: ReasoningEffort
    }
  ): Promise<ClientResult> => {
    const current = config()
    assertUsable(current, request.model?.trim() || current.model)
    if (request.localOnly && !current.local)
      throw new AiError(
        'private_blocked',
        '私密内容只发给本地模型，当前服务商不是本地的'
      )
    assertPrivacy(current, request.private, deps.settings.privateLocalOnly())
    const result = await chatCompletion(current, request, {
      ...deps.client,
      ...(options.retries === undefined ? {} : { retries: options.retries }),
      fetch: deps.fetch,
      signal: options.signal,
      onDelta: options.onDelta,
      json: options.json,
      reasoning: options.reasoning,
    })
    const summary = await deps.usage.record(result.usage)
    deps.onUsage?.(summary)
    return result
  }

  return {
    config,
    speechConfig: () => resolveSpeechConfig(deps.settings.speech(), config()),

    async chat(request, options = {}) {
      const result = await run(request, options)
      if (!result.content.trim())
        throw new AiError(
          'bad_response',
          `模型返回了空回答（结束原因 ${result.finishReason || '未知'}）${result.reasoning ? `，思考开头：${rawSnippet(result.reasoning, 120)}` : ''}`
        )
      return publicResult(result)
    },

    async chatJson<T>(
      request: AiJsonRequest,
      options: {
        signal?: AbortSignal
        validate?: (data: unknown) => data is T
      } = {}
    ): Promise<AiJsonResult<T>> {
      const { schema, schemaName, ...chat } = request
      const json = { schema, schemaName }
      const accept = (data: unknown): boolean =>
        data !== undefined && (!options.validate || options.validate(data))
      const call = { signal: options.signal, json, reasoning: QUICK_REASONING }
      const first = await run(chat, call)
      let result = first
      let data = parseModelJson(first)
      if (!accept(data)) {
        // 一次补救：被截断的给更多额度；其余带上原输出与纠正提示再问一次
        const retry: AiChatRequest =
          first.finishReason === 'length'
            ? { ...chat, maxTokens: (chat.maxTokens ?? 0) * 2 + 4096 }
            : {
                ...chat,
                messages: [
                  ...chat.messages,
                  {
                    role: 'assistant',
                    content: rawSnippet(rawOutput(first), 1000),
                  },
                  { role: 'user', content: JSON_REPAIR_HINT },
                ],
              }
        result = await run(retry, call)
        data = parseModelJson(result)
      }
      if (!accept(data)) {
        const raw = rawSnippet(rawOutput(result))
        console.warn(
          `[ai] 模型返回无法用作 JSON（${result.provider} / ${result.model}，结束原因 ${result.finishReason || '未知'}）原始返回前 500 字：${raw}`
        )
        throw new AiError(
          'bad_json',
          data === undefined
            ? `模型输出不是合法 JSON。原始返回：${raw}`
            : `模型输出的 JSON 结构不符合要求。原始返回：${raw}`
        )
      }
      return { ...publicResult(result), data: data as T }
    },

    async testConnection() {
      const started = Date.now()
      let current: AiConfig | null = null
      try {
        current = config()
        const result = await run(
          {
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 16,
            timeoutMs: 20_000,
          },
          { retries: 0, reasoning: QUICK_REASONING }
        )
        return {
          ok: true,
          provider: result.provider,
          model: result.model,
          latencyMs: Date.now() - started,
        }
      } catch (error) {
        const err =
          error instanceof AiError
            ? error
            : new AiError('network', String(error))
        return {
          ok: false,
          provider: current?.provider ?? deps.settings.chat().provider,
          model: current?.model ?? '',
          latencyMs: Date.now() - started,
          code: err.code,
          message: err.message.replace(/^\[ai:[a-z_]+\] /, ''),
        }
      }
    },

    usage: () => deps.usage.summary(),
  }
}
