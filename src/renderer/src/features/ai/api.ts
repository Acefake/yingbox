/**
 * 渲染层 AI 调用封装（window.api.ai）：所有 AI 功能从这里调模型，不直接碰 IPC。
 *
 * - chat / chatStream / chatJson：请求先转成普通对象再过 IPC（不传 Vue 响应式对象）。
 * - 取消：传 AbortSignal，abort 时通知主进程中止，Promise 以 cancelled 结束。
 * - 错误统一为 {@link AiCallError}（带 code），据此决定提示或降级。
 * - Web / PWA 模式没有主进程：调用直接抛 not_configured。
 */
import {
  type AiErrorCode,
  parseAiErrorMessage,
} from '../../../../shared/ai/types'
import type {
  AiCallOptions,
  AiChatRequest,
  AiChatResult,
  AiJsonRequest,
  AiJsonResult,
  AiStreamOptions,
  AiTestResult,
  AiUsageSummary,
} from './types'

const bridge = typeof window !== 'undefined' ? window.api?.ai : undefined

/** AI 调用失败（code 见 AiErrorCode） */
export class AiCallError extends Error {
  readonly code: AiErrorCode
  constructor(code: AiErrorCode, message: string) {
    super(message)
    this.name = 'AiCallError'
    this.code = code
  }
}

/** 把 IPC 抛回的错误还原成 AiCallError（无法识别时归为 network） */
export function toAiError(error: unknown): AiCallError {
  if (error instanceof AiCallError) return error
  const text = error instanceof Error ? error.message : String(error)
  const parsed = parseAiErrorMessage(text)
  return parsed
    ? new AiCallError(parsed.code, parsed.message)
    : new AiCallError('network', text)
}

/** 当前环境能否调用 AI（桌面端） */
export function aiAvailable(): boolean {
  return Boolean(bridge)
}

function requireBridge(): NonNullable<typeof bridge> {
  if (!bridge) throw new AiCallError('not_configured', 'AI 功能需要桌面端')
  return bridge
}

/** 流式增量按 requestId 分发（preload 的 off 会清掉全部监听，所以只订阅一次） */
const deltaHandlers = new Map<string, (delta: string) => void>()
const usageHandlers = new Set<(summary: AiUsageSummary) => void>()
let subscribed = false

function subscribe(): void {
  if (subscribed || !bridge) return
  subscribed = true
  bridge.onDelta(event => deltaHandlers.get(event.requestId)?.(event.delta))
  bridge.onUsageChanged(summary => usageHandlers.forEach(fn => fn(summary)))
}

let sequence = 0

function newRequestId(): string {
  sequence += 1
  return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${sequence}`
}

/** 请求转普通对象：只拷贝认识的字段 */
function plain<T extends AiChatRequest>(request: T): T {
  return JSON.parse(JSON.stringify(request)) as T
}

/** 带取消地跑一次调用 */
async function withSignal<R>(
  requestId: string,
  signal: AbortSignal | undefined,
  invoke: () => Promise<R>
): Promise<R> {
  const api = requireBridge()
  if (signal?.aborted) throw new AiCallError('cancelled', '已取消')
  const onAbort = (): void => void api.cancel(requestId).catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await invoke()
  } catch (error) {
    throw toAiError(error)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 非流式对话 */
export function chat(
  request: AiChatRequest,
  options: AiCallOptions = {}
): Promise<AiChatResult> {
  const requestId = newRequestId()
  const body = plain({ ...request, stream: false, requestId })
  return withSignal(requestId, options.signal, () => requireBridge().chat(body))
}

/** 流式对话：增量经 onDelta 回调，结束时返回完整结果 */
export async function chatStream(
  request: AiChatRequest,
  options: AiStreamOptions
): Promise<AiChatResult> {
  requireBridge()
  subscribe()
  const requestId = newRequestId()
  deltaHandlers.set(requestId, options.onDelta)
  try {
    const body = plain({ ...request, stream: true, requestId })
    return await withSignal(requestId, options.signal, () =>
      requireBridge().chat(body)
    )
  } finally {
    deltaHandlers.delete(requestId)
  }
}

/**
 * 结构化输出：返回解析后的 data。传 validate 时在渲染层再校验一次结构，
 * 不通过抛 bad_json。
 */
export async function chatJson<T = unknown>(
  request: AiJsonRequest,
  options: AiCallOptions & { validate?: (data: unknown) => data is T } = {}
): Promise<AiJsonResult<T>> {
  const requestId = newRequestId()
  const body = plain({ ...request, requestId })
  const result = await withSignal(requestId, options.signal, () =>
    requireBridge().chatJson(body)
  )
  if (options.validate && !options.validate(result.data))
    throw new AiCallError(
      'bad_json',
      `模型输出的 JSON 结构不符合要求。原始返回：${String(JSON.stringify(result.data)).slice(0, 500)}`
    )
  return result as AiJsonResult<T>
}

/** 用当前设置测试连接（失败不抛错，看 ok / message） */
export async function testAiConnection(): Promise<AiTestResult> {
  try {
    return await requireBridge().testConnection()
  } catch (error) {
    throw toAiError(error)
  }
}

/** 本月及最近几个月用量 */
export function getAiUsage(): Promise<AiUsageSummary> {
  return requireBridge().usage()
}

/** 订阅用量变化；返回退订函数 */
export function onAiUsageChanged(
  handler: (summary: AiUsageSummary) => void
): () => void {
  subscribe()
  usageHandlers.add(handler)
  return () => usageHandlers.delete(handler)
}
