/**
 * 从设置解析出一次调用实际用的配置，并做发出前的检查（纯函数，测试直接调）。
 *
 * - 接口地址 / 模型：设置里填了用设置，空串用服务商预设；自定义服务商两者必填。
 * - API Key：每个服务商各存一份密钥（ai.apiKey.<id>），切换服务商不用重填。
 * - 本地：Ollama，或接口地址指向本机 / 局域网（见 isLocalEndpoint）。
 * - 私密：调用方标记 private 且设置「私密板块只用本地模型」打开时，非本地服务商直接拒绝。
 */
import {
  aiConfigProblem,
  aiKeySecret,
  aiProviderPreset,
  resolveAiEndpoint,
} from '../../shared/ai/providers'
import type { AiProviderId } from '../../shared/ai/types'
import { AiError } from './errors'

/** 设置里与对话相关的值 */
export interface AiSettingValues {
  provider: AiProviderId
  baseUrl: string
  model: string
}

/** 一次调用的完整配置（含明文 Key，只在主进程内存里） */
export interface AiConfig {
  provider: AiProviderId
  /** 接口地址，已去掉结尾斜杠 */
  baseUrl: string
  model: string
  apiKey: string
  /** 本机 / 局域网服务商 */
  local: boolean
  /** 支持 response_format: json_schema */
  jsonSchema: boolean
}

/** 由设置值 + 取密钥函数解析出配置（不校验，校验见 {@link assertUsable}） */
export function resolveAiConfig(
  values: AiSettingValues,
  getSecret: (key: NonNullable<ReturnType<typeof aiKeySecret>>) => string
): AiConfig {
  const preset = aiProviderPreset(values.provider)
  const endpoint = resolveAiEndpoint(values)
  const secret = aiKeySecret(values.provider)
  return {
    provider: preset.id,
    baseUrl: endpoint.baseUrl,
    model: endpoint.model,
    apiKey: secret ? getSecret(secret).trim() : '',
    local: endpoint.local,
    jsonSchema: preset.jsonSchema,
  }
}

/** 配置能否发请求；不能时抛 not_configured（判定见 shared 的 aiConfigProblem，渲染层共用） */
export function assertUsable(config: AiConfig, model = config.model): void {
  const problem = aiConfigProblem({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model,
    local: config.local,
    hasKey: Boolean(config.apiKey),
  })
  if (problem) throw new AiError('not_configured', problem)
}

/** 私密内容的去向检查：不允许时抛 private_blocked */
export function assertPrivacy(
  config: AiConfig,
  isPrivate: boolean | undefined,
  privateLocalOnly: boolean
): void {
  if (isPrivate && privateLocalOnly && !config.local)
    throw new AiError(
      'private_blocked',
      '私密板块的内容只发给本地模型，当前服务商不是本地的'
    )
}

/** 语音识别配置（AI 字幕 PR 使用；本 PR 只解析，不实现识别） */
export interface AiSpeechConfig {
  engine: 'off' | 'local-whisper' | 'cloud'
  /** 本地 Whisper 模型名 / 云端转写模型 */
  model: string
  /** 云端转写接口地址（OpenAI 兼容 /audio/transcriptions 的前缀）；本地为空 */
  baseUrl: string
  /** 云端转写用的 Key（与对话服务商同一份）；本地为空 */
  apiKey: string
}

/** 由设置值解析语音识别配置；云端地址留空时沿用对话接口 */
export function resolveSpeechConfig(
  values: { engine: AiSpeechConfig['engine']; model: string; baseUrl: string },
  chat: AiConfig
): AiSpeechConfig {
  if (values.engine !== 'cloud')
    return {
      engine: values.engine,
      model: values.model,
      baseUrl: '',
      apiKey: '',
    }
  return {
    engine: 'cloud',
    model: values.model,
    baseUrl: (values.baseUrl.trim() || chat.baseUrl).replace(/\/+$/, ''),
    apiKey: chat.apiKey,
  }
}
