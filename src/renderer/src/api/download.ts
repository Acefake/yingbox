/**
 * 下载队列（引擎 download 域）的渲染层封装：响应式快照 + 增删重试。
 * 快照随引擎事件更新；Web 模式没有引擎，available 为 false。
 */
import { onScopeDispose, shallowRef } from 'vue'
import type {
  AddResult,
  DownloadSnapshot,
} from '../../../shared/contract/download'

const EMPTY: DownloadSnapshot = { queued: [], completed: [], failed: [] }

/** 加入失败的原因 → 提示文案 */
export const ADD_REASON: Record<
  Exclude<AddResult, { added: true }>['reason'],
  string
> = {
  invalid: '番号只能包含字母、数字、- 和 _',
  exists: '已经下载过了',
  queued: '已在下载队列中',
  full: '下载队列已满',
}

/** 订阅下载队列。组件卸载时自动退订。 */
export function useDownloads(): {
  available: boolean
  snapshot: Readonly<{ value: DownloadSnapshot }>
  add: (code: string) => Promise<AddResult>
  remove: (code: string) => Promise<void>
  retry: (code: string) => Promise<AddResult>
} {
  const api = typeof window !== 'undefined' ? window.api?.download : undefined
  const snapshot = shallowRef<DownloadSnapshot>(EMPTY)
  if (api) {
    api.onChanged(next => (snapshot.value = next))
    void api.list().then(next => (snapshot.value = next))
    onScopeDispose(() => api.offChanged())
  }
  const refresh = async <T>(task: Promise<T>): Promise<T> => {
    const result = await task
    if (api) snapshot.value = await api.list()
    return result
  }
  const unavailable = (): never => {
    throw new Error('下载需要桌面端')
  }
  return {
    available: Boolean(api),
    snapshot,
    add: code => (api ? refresh(api.add(code)) : unavailable()),
    remove: code => (api ? refresh(api.remove(code)) : unavailable()),
    retry: code => (api ? refresh(api.retry(code)) : unavailable()),
  }
}
