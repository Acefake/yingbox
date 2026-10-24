/**
 * Chat Completions 流式响应（SSE）解析：把字节流切成 `data:` 事件，交给回调。
 * 纯逻辑，测试直接喂字符串分片。
 */

/** 一个流式分片里我们关心的字段 */
export interface StreamChunk {
  model?: string
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

/**
 * 增量 SSE 解析器：push 任意切分的文本，按行凑出完整事件。
 * `data: [DONE]` 触发 onDone；无法解析的 data 行忽略（部分服务商会发心跳注释）。
 */
export function createSseParser(handlers: {
  onChunk: (chunk: StreamChunk) => void
  onDone: () => void
}): { push(text: string): void; end(): void } {
  let buffer = ''
  let data: string[] = []

  const dispatch = (): void => {
    if (data.length === 0) return
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') {
      handlers.onDone()
      return
    }
    try {
      handlers.onChunk(JSON.parse(payload) as StreamChunk)
    } catch {
      // 非 JSON 的 data 行（心跳等）忽略
    }
  }

  const line = (raw: string): void => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (text === '') dispatch()
    else if (text.startsWith(':')) return
    else if (text.startsWith('data:'))
      data.push(text.slice(5).replace(/^ /, ''))
  }

  return {
    push(text) {
      buffer += text
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        line(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    },
    end() {
      if (buffer) line(buffer)
      buffer = ''
      dispatch()
    },
  }
}
