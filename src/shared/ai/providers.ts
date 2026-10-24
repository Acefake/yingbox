/**
 * AI 服务商预设与「是否本地」判定。全部走 OpenAI 兼容 Chat Completions，一套代码。
 *
 * 设置页用预设显示默认接口地址 / 模型，主进程用它解析实际配置。纯 TS（会被 preload 间接打包）。
 */
import type { AiProviderId } from './types'

/** 一个服务商预设 */
export interface AiProviderPreset {
  id: AiProviderId
  /** 显示名 */
  label: string
  /** 默认接口地址（含 /v1）；自定义为空 */
  baseUrl: string
  /** 默认对话模型；自定义为空 */
  model: string
  /** 是否需要 API Key */
  needsKey: boolean
  /** 是否支持 response_format: json_schema */
  jsonSchema: boolean
}

/** 全部预设（设置页按此顺序列出） */
export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needsKey: true,
    jsonSchema: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsKey: true,
    jsonSchema: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    needsKey: true,
    jsonSchema: true,
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
    jsonSchema: false,
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    needsKey: false,
    jsonSchema: false,
  },
]

/** 全部服务商 id */
export const AI_PROVIDER_IDS = AI_PROVIDERS.map(
  p => p.id
) as readonly AiProviderId[]

/** 按 id 取预设（未知 id 回落到自定义） */
export function aiProviderPreset(id: AiProviderId): AiProviderPreset {
  return (
    AI_PROVIDERS.find(p => p.id === id) ?? AI_PROVIDERS[AI_PROVIDERS.length - 1]
  )
}

/** 每个服务商各存一个 Key 的设置密钥名（Ollama 不需要 Key，没有这一项） */
export type AiKeySecret =
  | 'ai.apiKey.openai'
  | 'ai.apiKey.deepseek'
  | 'ai.apiKey.openrouter'
  | 'ai.apiKey.custom'

/** 服务商对应的 Key 密钥名；Ollama 为 null */
export function aiKeySecret(id: AiProviderId): AiKeySecret | null {
  return id === 'ollama' ? null : `ai.apiKey.${id}`
}

/**
 * 接口地址是否指向本机或局域网（视为「本地模型」，私密内容可以发）。
 * 本机：localhost / 127.0.0.0/8 / ::1；局域网：10/8、172.16/12、192.168/16、169.254/16、fc00::/7、*.local。
 * 地址无法解析时按非本地处理。
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  host = host.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local')) return true
  if (host === '::1') return true
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}
