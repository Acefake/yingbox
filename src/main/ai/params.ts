/**
 * 可选请求参数的服务商适配：推理强度怎么写、哪些模型不认某个参数。
 *
 * 推理强度只对有官方文档或实测依据的服务商发送，其余（自定义接口）不发：
 * - OpenAI：`reasoning_effort`，只有推理模型（o 系列、GPT-5 及以后）认，其它模型会 400，所以按模型名判断；
 * - OpenRouter：统一的 `reasoning: { effort }`，非推理模型由 OpenRouter 忽略；
 * - DeepSeek：`reasoning_effort`（low / high / max），关闭思考是 `thinking: { type: 'disabled' }`；
 * - OpenCode Go：Chat Completions 透传 `reasoning_effort`（实测 GLM / DeepSeek / Kimi 都认，
 *   GLM-5.3 不允许 none）；
 * - Ollama：OpenAI 兼容接口支持 `reasoning_effort`，模型不认的档位回落到模型默认。
 *
 * 服务商仍可能按模型拒绝（400 / 422 且错误说明点名该参数），客户端去掉参数重发一次，
 * 并用 {@link ParamMemory} 记住「这个模型不认」，本次运行内不再发。
 */
import type { AiProviderId } from '../../shared/ai/types'
import type { AiConfig } from './config'
import type { AiError } from './errors'

/** 推理强度：none 关闭思考（不是所有模型都允许），low 最快，其余按服务商默认档位映射 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'

/** 可能被模型拒绝、可以去掉重发的参数 */
export type OptionalParam = 'reasoning' | 'temperature'

/** OpenAI 的推理模型：o1 / o3 / o4-mini…、gpt-5 及以后 */
const OPENAI_REASONING_MODEL = /^(o\d|gpt-([5-9]|\d{2}))/i

/** 推理强度对应的请求字段；该服务商 / 模型没有依据时返回空对象 */
export function reasoningParams(
  provider: AiProviderId,
  model: string,
  effort: ReasoningEffort | undefined
): Record<string, unknown> {
  if (!effort) return {}
  switch (provider) {
    case 'openai':
      return OPENAI_REASONING_MODEL.test(model.trim())
        ? { reasoning_effort: effort }
        : {}
    case 'openrouter':
      return { reasoning: { effort } }
    case 'deepseek':
      return effort === 'none'
        ? { thinking: { type: 'disabled' } }
        : { reasoning_effort: effort }
    case 'opencode-go':
    case 'ollama':
      return { reasoning_effort: effort }
    default:
      return {}
  }
}

/** 错误说明点名的参数 */
const PARAM_PATTERNS: Record<OptionalParam, RegExp> = {
  reasoning: /reasoning|thinking/i,
  temperature: /temperature/i,
}

/**
 * 400 / 422 是不是在拒绝某个已发送的可选参数；是则返回该参数。
 * 只看本次真的发了的参数，避免把无关的 400 当成参数问题。
 */
export function rejectedParam(
  error: AiError,
  sent: readonly OptionalParam[]
): OptionalParam | null {
  if (error.code !== 'http' || (error.status !== 400 && error.status !== 422))
    return null
  return sent.find(param => PARAM_PATTERNS[param].test(error.message)) ?? null
}

/** 记住哪些模型不认哪些可选参数（只在内存里，重启后重新探测） */
export interface ParamMemory {
  unsupported(config: AiConfig, model: string, param: OptionalParam): boolean
  remember(config: AiConfig, model: string, param: OptionalParam): void
}

/** 新建一份记忆；AI 服务整个运行期共用一份 */
export function createParamMemory(): ParamMemory {
  const known = new Set<string>()
  const key = (config: AiConfig, model: string, param: OptionalParam): string =>
    `${config.provider}\n${config.baseUrl}\n${model}\n${param}`
  return {
    unsupported: (config, model, param) => known.has(key(config, model, param)),
    remember: (config, model, param) => {
      known.add(key(config, model, param))
    },
  }
}
