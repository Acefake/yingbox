/**
 * 从 Chat Completions 的 message / 流式 delta 里取出回答（纯函数，测试直接喂各服务商的返回形态）。
 *
 * 各家把回答放的位置不一样：
 * - content 通常是字符串，也可能是 null（只有思考或工具调用时）或分段数组 `[{ type: 'text', text }]`；
 * - 思考型模型（DeepSeek、GLM、Kimi、Qwen3 等）把思考放在 reasoning_content（OpenRouter 叫 reasoning），
 *   思考同样计入 max_tokens，额度用光时 content 为空、finish_reason 为 length；
 * - 少数服务商按工具调用回结构化结果：tool_calls[0].function.arguments 才是 JSON。
 */

/** 一条回答里我们关心的三部分 */
export interface MessageParts {
  /** 正文 */
  content: string
  /** 思考过程（不给用户看，只用于诊断与 JSON 兜底） */
  reasoning: string
  /** 第一个工具调用的参数文本 */
  toolArgs: string
}

/** content 字段 → 文本：字符串原样，分段数组拼 text，其余当空 */
export function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(part => {
      if (typeof part === 'string') return part
      const text = (part as { text?: unknown } | null)?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** 思考字段：reasoning_content（DeepSeek / 多数国产）或 reasoning（OpenRouter / Ollama） */
function reasoningText(message: Record<string, unknown>): string {
  return (
    contentText(message.reasoning_content) || contentText(message.reasoning)
  )
}

/** 第一个工具调用的参数（arguments 可能是字符串或已解析的对象） */
function toolArgsText(message: Record<string, unknown>): string {
  const calls = message.tool_calls
  if (!Array.isArray(calls) || !calls.length) return ''
  const fn = (calls[0] as { function?: { arguments?: unknown } } | null)
    ?.function
  const args = fn?.arguments
  if (typeof args === 'string') return args
  return args && typeof args === 'object' ? JSON.stringify(args) : ''
}

/** 非流式 choices[0].message → 三部分 */
export function messageParts(message: unknown): MessageParts {
  const m =
    message && typeof message === 'object'
      ? (message as Record<string, unknown>)
      : {}
  return {
    content: contentText(m.content),
    reasoning: reasoningText(m),
    toolArgs: toolArgsText(m),
  }
}

/** 流式 delta → 本块新增的三部分（工具调用参数按片段拼接） */
export function deltaParts(delta: unknown): MessageParts {
  const d =
    delta && typeof delta === 'object' ? (delta as Record<string, unknown>) : {}
  const calls = Array.isArray(d.tool_calls) ? d.tool_calls : []
  const args = (calls[0] as { function?: { arguments?: unknown } } | undefined)
    ?.function?.arguments
  return {
    content: contentText(d.content),
    reasoning: reasoningText(d),
    toolArgs: typeof args === 'string' ? args : '',
  }
}

/** 截取原始返回的前 n 个字（日志与错误说明用），压掉多余空白 */
export function rawSnippet(text: string, n = 500): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}
