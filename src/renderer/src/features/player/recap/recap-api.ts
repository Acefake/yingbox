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

/** 准备上下文（之前各集摘要，问剧情再加本集已播部分） */
export function prepareRecap(
  localUrl: string,
  options: RecapPrepareOptions
): Promise<RecapContext> {
  const api = bridge()
  if (!api) return Promise.reject(new Error('前情提要需要桌面端'))
  return api.prepare(localUrl, { ...options })
}

/** 生成完的前情提要按集缓存（失败不影响展示） */
export async function saveRecap(options: RecapSaveOptions): Promise<void> {
  await bridge()
    ?.save({ ...options })
    .catch(() => {})
}
