/**
 * 读模型响应：非流式 JSON 与流式 SSE，统一成 {@link ClientResult}（正文、思考、工具调用参数、用量）。
 * 回答放在哪个字段由 response.ts 判断；这里只负责读流与报协议级错误。
 */
import type { AiChatRequest, AiTokenUsage } from '../../shared/ai/types'
import type { ClientResult } from './client'
import type { AiConfig } from './config'
import { AiError, streamError } from './errors'
import { deltaParts, messageParts, rawSnippet } from './response'
import { type StreamChunk, createSseParser } from './sse'

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

/** 非流式响应：正文 / 思考 / 工具调用分别取出；连 choices 都没有才算 bad_response */
export async function readJson(
  config: AiConfig,
  request: AiChatRequest,
  response: Response
): Promise<ClientResult> {
  const text = await response.text().catch(() => '')
  let body: {
    model?: string
    choices?: Array<{ message?: unknown; finish_reason?: string | null }>
    usage?: StreamChunk['usage']
    error?: unknown
  }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    throw new AiError(
      'bad_response',
      `AI 接口返回的不是 JSON：${rawSnippet(text)}`
    )
  }
  if (body?.error && !body.choices)
    throw streamError(body.error as Parameters<typeof streamError>[0])
  const choice = body?.choices?.[0]
  if (!choice || typeof choice !== 'object')
    throw new AiError(
      'bad_response',
      `AI 接口的响应里没有回答内容：${rawSnippet(text)}`
    )
  return {
    ...messageParts(choice.message),
    model: body.model || request.model || config.model,
    provider: config.provider,
    finishReason: choice.finish_reason ?? '',
    usage: toUsage(body.usage),
  }
}

/**
 * 流式响应：逐块解析 SSE，增量回调，结束时汇总；流里出现 error 事件立即抛 AiError，不返回部分内容。
 * 流结束时既没有 `data: [DONE]` 也没有任何 finish_reason，说明连接中途断了（代理空闲断开等）：
 * 抛可重试的 network 错误，不把半截回答当成完整结果（已推出过增量时客户端不重试，调用方据此提示）。
 */
export async function readStream(
  config: AiConfig,
  request: AiChatRequest,
  response: Response,
  onDelta: (delta: string) => void
): Promise<ClientResult> {
  if (!response.body) throw new AiError('bad_response', 'AI 接口没有返回流')
  let content = ''
  let reasoning = ''
  let toolArgs = ''
  let model = ''
  let finishReason = ''
  let usage: AiTokenUsage | null = null
  let done = false
  const parser = createSseParser({
    onChunk: chunk => {
      if (chunk.error) throw streamError(chunk.error)
      if (chunk.model) model = chunk.model
      const choice = chunk.choices?.[0]
      const parts = deltaParts(choice?.delta)
      reasoning += parts.reasoning
      toolArgs += parts.toolArgs
      if (parts.content) {
        content += parts.content
        onDelta(parts.content)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      usage = toUsage(chunk.usage) ?? usage
    },
    onDone: () => {
      done = true
    },
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
  if (!done && !finishReason)
    throw new AiError(
      'network',
      `AI 流式响应中途断开（已收到 ${[...content].length} 字）`,
      { retryable: true }
    )
  return {
    content,
    reasoning,
    toolArgs,
    model: model || request.model || config.model,
    provider: config.provider,
    finishReason,
    usage,
  }
}
