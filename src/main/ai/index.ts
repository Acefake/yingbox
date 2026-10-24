/**
 * 主进程 AI 模块入口：组装 {@link createAiService}（设置、net.fetch、用量文件）并注册 ai 域 IPC。
 *
 * - 主进程里的其他模块（AI 字幕、刮削兜底等）用 {@link aiService} 直接调用，不经 IPC。
 * - 渲染层的流式请求按「窗口 + requestId」登记，ai.cancel 或窗口销毁时中止。
 * - net.fetch 走 Chromium 网络栈与系统代理；本地 Ollama（127.0.0.1）同样可达。
 */
import { type WebContents, app, net } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { ai } from '../../shared/contract/ai'
import { atomicWrite } from '../file-operations'
import { emit, implement } from '../rpc'
import { settingsStore } from '../settings'
import { type AiService, createAiService } from './service'
import { createUsageStore } from './usage'

export type { AiService } from './service'
export type { AiConfig, AiSpeechConfig } from './config'
export { AiError } from './errors'

let service: AiService | null = null

/** 已注册的 AI 服务；必须在 {@link registerAi} 之后调用 */
export function aiService(): AiService {
  if (!service) throw new Error('[ai] 尚未初始化')
  return service
}

/** 渲染层发起、还没结束的请求：键为「webContents id:requestId」 */
const inflight = new Map<string, AbortController>()

/** 登记一个请求的取消器；窗口销毁时一并取消 */
function track(
  sender: WebContents,
  requestId: string | undefined
): {
  signal: AbortSignal
  done: () => void
} {
  const controller = new AbortController()
  if (!requestId) return { signal: controller.signal, done: () => {} }
  const key = `${sender.id}:${requestId}`
  inflight.get(key)?.abort()
  inflight.set(key, controller)
  const onDestroyed = (): void => controller.abort()
  sender.once('destroyed', onDestroyed)
  return {
    signal: controller.signal,
    done: () => {
      if (inflight.get(key) === controller) inflight.delete(key)
      sender.removeListener('destroyed', onDestroyed)
    },
  }
}

/** 创建 AI 服务并注册 ai 域（initSettings 之后调用一次） */
export function registerAi(): AiService {
  const store = settingsStore()
  const usageFile = join(app.getPath('userData'), 'ai', 'usage.json')
  const created = createAiService({
    settings: {
      chat: () => ({
        provider: store.get('ai.provider'),
        baseUrl: store.get('ai.baseUrl'),
        model: store.get('ai.model'),
      }),
      privateLocalOnly: () => store.get('ai.privateLocalOnly'),
      speech: () => ({
        engine: store.get('ai.speech.engine'),
        model: store.get('ai.speech.model'),
        baseUrl: store.get('ai.speech.baseUrl'),
      }),
      secret: key => store.getSecret(key),
    },
    fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
    usage: createUsageStore({
      read: () =>
        fs.readFile(usageFile, 'utf8').catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }),
      write: async text => {
        await fs.mkdir(dirname(usageFile), { recursive: true })
        await atomicWrite(usageFile, text)
      },
    }),
    onUsage: summary => emit(ai, 'usageChanged', summary),
  })
  service = created

  implement(ai, {
    chat: async ({ sender }, request) => {
      const { signal, done } = track(sender, request.requestId)
      const requestId = request.requestId
      try {
        return await created.chat(request, {
          signal,
          onDelta:
            request.stream && requestId
              ? delta => emit(ai, 'delta', { requestId, delta }, sender)
              : undefined,
        })
      } finally {
        done()
      }
    },
    chatJson: async ({ sender }, request) => {
      const { signal, done } = track(sender, request.requestId)
      try {
        return await created.chatJson(request, { signal })
      } finally {
        done()
      }
    },
    cancel: ({ sender }, requestId) => {
      const controller = inflight.get(`${sender.id}:${requestId}`)
      controller?.abort()
      return Boolean(controller)
    },
    testConnection: () => created.testConnection(),
    usage: () => created.usage(),
  })
  return created
}
