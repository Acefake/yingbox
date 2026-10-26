/**
 * Chat Completions 请求体：消息、温度、max_tokens、流式用量、JSON 模式 / json_schema、推理强度。
 *
 * 模型不认的可选参数由调用方通过 omit 去掉（见 params.ts 与 client.ts 的降级重发）。
 */
import type { AiChatRequest } from '../../shared/ai/types'
import type { AiConfig } from './config'
import {
  type OptionalParam,
  type ReasoningEffort,
  reasoningParams,
} from './params'

/** JSON 输出要求 */
export interface JsonOutput {
  schema?: Record<string, unknown>
  schemaName?: string
  /**
   * 只靠提示词要 JSON，不发 response_format。服务商不认 response_format（400）时
   * 客户端（chatCompletion）自动降级成这一档。
   */
  promptOnly?: boolean
}

/** JSON 调用的最低 max_tokens：JSON 本身很短，给足余量让思考型模型想完再输出 */
export const JSON_MIN_TOKENS = 2048

/** 一次请求实际用的模型 */
export const modelOf = (config: AiConfig, request: AiChatRequest): string =>
  request.model?.trim() || config.model

/** 请求体的可选部分 */
export interface BodyOptions {
  stream: boolean
  json?: JsonOutput
  reasoning?: ReasoningEffort
  /** 不发的可选参数（模型不认） */
  omit?: readonly OptionalParam[]
}

/** 请求体：Chat Completions 字段，按需加流式用量、JSON 模式 / json_schema、推理强度 */
export function buildChatBody(
  config: AiConfig,
  request: AiChatRequest,
  options: BodyOptions
): Record<string, unknown> {
  const messages = request.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))
  const model = modelOf(config, request)
  const omit = options.omit ?? []
  const body: Record<string, unknown> = { model, messages }
  if (request.temperature !== undefined && !omit.includes('temperature'))
    body.temperature = request.temperature
  if (!omit.includes('reasoning'))
    Object.assign(
      body,
      reasoningParams(config.provider, model, options.reasoning)
    )
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

/** 这次请求体里实际带了哪些可选参数 */
export function sentParams(
  config: AiConfig,
  request: AiChatRequest,
  options: BodyOptions
): OptionalParam[] {
  const omit = options.omit ?? []
  const sent: OptionalParam[] = []
  if (
    !omit.includes('reasoning') &&
    Object.keys(
      reasoningParams(
        config.provider,
        modelOf(config, request),
        options.reasoning
      )
    ).length > 0
  )
    sent.push('reasoning')
  if (request.temperature !== undefined && !omit.includes('temperature'))
    sent.push('temperature')
  return sent
}
