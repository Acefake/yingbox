/**
 * AI 服务：所有 AI 功能（渲染层经 IPC，或主进程里的 AI 字幕等模块直接调用）的唯一入口。
 *
 * 每次调用都重新读设置（改了服务商 / 模型立即生效），依次做：配置检查 → 私密检查 → 发请求 → 记用量。
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
import { type ClientOptions, type FetchLike, chatCompletion } from './client'
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
import { parseJsonLoose } from './json'
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
  /** 客户端选项覆盖（测试用：重试间隔、sleep） */
  client?: Pick<ClientOptions, 'retries' | 'retryDelayMs' | 'sleep'>
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

/** 创建 AI 服务 */
export function createAiService(deps: AiServiceDeps): AiService {
  const config = (): AiConfig =>
    resolveAiConfig(deps.settings.chat(), key => deps.settings.secret(key))

  const run = async (
    request: AiChatRequest,
    options: AiCallOptions & {
      json?: ClientOptions['json']
      retries?: number
    }
  ): Promise<AiChatResult> => {
    const current = config()
    assertUsable(current, request.model?.trim() || current.model)
    assertPrivacy(
      current,
      request.private || request.localOnly,
      request.localOnly === true || deps.settings.privateLocalOnly()
    )
    const result = await chatCompletion(current, request, {
      ...deps.client,
      ...(options.retries === undefined ? {} : { retries: options.retries }),
      fetch: deps.fetch,
      signal: options.signal,
      onDelta: options.onDelta,
      json: options.json,
    })
    const summary = await deps.usage.record(result.usage)
    deps.onUsage?.(summary)
    return result
  }

  return {
    config,
    speechConfig: () => resolveSpeechConfig(deps.settings.speech(), config()),

    chat: (request, options = {}) => run(request, options),

    async chatJson<T>(
      request: AiJsonRequest,
      options: {
        signal?: AbortSignal
        validate?: (data: unknown) => data is T
      } = {}
    ): Promise<AiJsonResult<T>> {
      const { schema, schemaName, ...chat } = request
      const result = await run(chat, {
        signal: options.signal,
        json: { schema, schemaName },
      })
      const data = parseJsonLoose(result.content)
      if (data === undefined)
        throw new AiError(
          'bad_json',
          `模型输出不是合法 JSON：${result.content.slice(0, 120)}`
        )
      if (options.validate && !options.validate(data))
        throw new AiError('bad_json', '模型输出的 JSON 结构不符合要求')
      return { ...result, data: data as T }
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
          { retries: 0 }
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
