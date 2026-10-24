/**
 * 媒体库引擎请主进程代办的事（线协议的 host / reply，见 shared/utility/protocol.ts）：按 id 配对请求与回复。
 *
 * 目前只有 AI 识别兜底用到：大模型的配置、密钥与用量统计都在主进程（src/main/ai），
 * 引擎经 {@link LIBRARY_HOST_METHODS} 里的两个方法调用，主进程实现见 src/main/library/ai-host.ts。
 */
import type { AiJsonRequest } from '../../../shared/ai/types'
import type { FromUtility, ToUtility } from '../../../shared/utility/protocol'
import type { LibraryAi, LibraryAiStatus } from '../identify/ai/ai-scrape-rules'

/** 主进程为媒体库引擎实现的代办方法名。 */
export const LIBRARY_HOST_METHODS = {
  aiStatus: 'aiStatus',
  aiChatJson: 'aiChatJson',
} as const

/** 代办调用口。 */
export interface HostCaller {
  call(method: string, ...args: unknown[]): Promise<unknown>
  /** 收到主进程的 reply 时调用。 */
  settle(message: Extract<ToUtility, { kind: 'reply' }>): void
}

/** 创建代办调用口；post 把消息发给主进程。 */
export function createHostCaller(
  post: (message: FromUtility) => void
): HostCaller {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  return {
    call(method, ...args) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        post({ kind: 'host', id, method, args })
      })
    },
    settle(message) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new Error(message.error.message))
    },
  }
}

/** 经主进程代办的大模型调用口。 */
export function hostAi(host: HostCaller): LibraryAi {
  return {
    status: () =>
      host.call(LIBRARY_HOST_METHODS.aiStatus) as Promise<LibraryAiStatus>,
    chatJson: (request: AiJsonRequest) =>
      host.call(LIBRARY_HOST_METHODS.aiChatJson, request),
  }
}
