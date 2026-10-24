/**
 * 渲染层的前情提要素材接口（window.api.recap）：探测、准备上下文、保存结果。
 * 只接受 local:// 地址；Web / PWA 模式没有主进程，recapAvailable() 为 false。
 */
import type {
  RecapContext,
  RecapPrepareOptions,
  RecapProbe,
  RecapSaveOptions,
} from '../../../../../shared/recap/types'

const bridge = (): Window['api']['recap'] | undefined =>
  typeof window !== 'undefined' ? window.api?.recap : undefined

/** 当前环境能否用前情提要 / 问剧情（桌面端） */
export function recapAvailable(): boolean {
  return Boolean(bridge())
}

/** 开播探测（不调模型）；不可用时返回 null */
export async function probeRecap(
  localUrl: string,
  isPrivate: boolean
): Promise<RecapProbe | null> {
  const api = bridge()
  if (!api) return null
  return api.probe(localUrl, isPrivate ? { private: true } : {})
}

let sequence = 0

/** 本窗口内唯一的请求标识 */
function newRequestId(): string {
  sequence += 1
  return globalThis.crypto?.randomUUID?.() ?? `recap-${Date.now()}-${sequence}`
}

/**
 * 准备上下文（之前各集摘要，问剧情再加本集已播部分）。
 * signal 中止时经 recap.cancel 让主进程停掉还没发出的分段摘要，并立刻以 AbortError 结束。
 */
export async function prepareRecap(
  localUrl: string,
  options: RecapPrepareOptions,
  signal?: AbortSignal
): Promise<RecapContext> {
  const api = bridge()
  if (!api) throw new Error('前情提要需要桌面端')
  const aborted = (): DOMException => new DOMException('已取消', 'AbortError')
  if (signal?.aborted) throw aborted()
  const requestId = newRequestId()
  let onAbort = (): void => {}
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      void api.cancel(requestId).catch(() => {})
      reject(aborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([
      api.prepare(localUrl, { ...options, requestId }),
      cancelled,
    ])
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 生成完的前情提要按集缓存（失败不影响展示） */
export async function saveRecap(options: RecapSaveOptions): Promise<void> {
  await bridge()
    ?.save({ ...options })
    .catch(() => {})
}
