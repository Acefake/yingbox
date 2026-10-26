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
 *
 * 结束判定（服务商契约：OpenAI 兼容流应发 `data: [DONE]` 或 finish_reason，二者有其一即算完成）：
 * - 收到 `[DONE]` 或任意 finish_reason（含 length）→ 完成；
 * - 两样都没有，但连接正常关闭、收到过正文或工具参数、最后一个事件完整 → 也按完成处理
 *   （兼容两样都不发的服务商；读流异常关闭时 reader 会抛错，走网络错误）；
 * - 两样都没有，且什么正文都没收到（只有心跳或只有思考）或最后一个事件是半截 JSON → 视为中途断开，
 *   抛 network；只有还没推出过正文增量时才可重试，避免重试把已显示的半句再拼一遍。
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
  let sawDone = false
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
      sawDone = true
    },
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    truncated = parser.end()
  } catch (error) {
    reader.cancel().catch(() => {})
    throw error
  }
  const received = content !== '' || toolArgs !== ''
  if (!sawDone && !finishReason && (truncated || !received))
    throw new AiError(
      'network',
      `AI 流式响应中途断开（正文 ${content.length} 字符、思考 ${reasoning.length} 字符）`,
      { retryable: content === '' }
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
