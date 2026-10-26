/**
 * Chat Completions 流式响应（SSE）解析：把字节流切成 `data:` 事件，交给回调。
 * 纯逻辑，测试直接喂字符串分片。
 */

/** 一个流式分片里我们关心的字段 */
export interface StreamChunk {
  model?: string
  choices?: Array<{
    /** 增量：content / reasoning_content / reasoning / tool_calls，取法见 response.ts 的 deltaParts */
    delta?: Record<string, unknown> | null
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
  /** 部分服务商在 HTTP 200 的流里用 data: {"error":…} 报错（字符串或 { message, code }） */
  error?: { message?: unknown; code?: unknown; type?: unknown } | string | null
}

/**
 * 增量 SSE 解析器：push 任意切分的文本，按行凑出完整事件。
 * `data: [DONE]` 触发 onDone；无法解析的 data 行忽略（部分服务商会发心跳注释），不抛错。
 * onChunk 抛出的错误原样冒泡到 push / end 的调用方（用于中止读流）。
 * end() 返回最后一个事件是否是半截 JSON（以 `{` / `[` 开头却解析失败）：流在事件中间被切断的信号。
 */
export function createSseParser(handlers: {
  onChunk: (chunk: StreamChunk) => void
  onDone: () => void
}): { push(text: string): void; end(): boolean } {
  let buffer = ''
  let data: string[] = []

  /** 派发攒好的事件；返回 true 表示它像 JSON 却解析失败（半截事件） */
  const dispatch = (): boolean => {
    if (data.length === 0) return false
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') {
      handlers.onDone()
      return false
    }
    let chunk: StreamChunk
    try {
      chunk = JSON.parse(payload) as StreamChunk
    } catch {
      // 非 JSON 的 data 行（心跳等）忽略；像 JSON 却解析失败的记为半截
      return /^\s*[{[]/.test(payload)
    }
    if (chunk && typeof chunk === 'object') handlers.onChunk(chunk)
    return false
  }

  const line = (raw: string): void => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (text === '') void dispatch()
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
      return dispatch()
    },
  }
}
