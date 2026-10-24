/**
 * 发起 AI 识别：按条目或按媒体库排队 identify({ ai: true })，等这些任务的 identify-progress 结束事件。
 *
 * 参数先转成普通数组再交给 bridge（不传 Vue 响应式对象）。
 */
import type {
  IdentifyProgressEvent,
  LibraryBridge,
} from '../../../../../shared/library/ipc'
import { onLibraryEvent } from '../state/library-events'
import {
  type AiIdentifyTotals,
  sumProgress,
  terminalOf,
} from './ai-scrape-rules'

/** AI 识别范围：指定条目，或若干媒体库里全部待确认 / 未匹配的条目。 */
export type AiIdentifyScope = { itemIds: number[] } | { libraryIds: number[] }

/** 排队 AI 识别并等全部任务结束，返回合计的结果。 */
export async function runAiIdentify(
  bridge: Pick<LibraryBridge, 'identify'>,
  scope: AiIdentifyScope
): Promise<AiIdentifyTotals> {
  // 先订阅再排队：小任务可能在 identify 返回之前就结束；同一任务只记第一次结束
  const ended = new Map<number, IdentifyProgressEvent>()
  let wanted: number[] | null = null
  let resolveAll: () => void = () => {}
  const allDone = new Promise<void>(resolve => (resolveAll = resolve))
  const check = (): void => {
    if (wanted && wanted.every(id => ended.has(id))) resolveAll()
  }
  const off = onLibraryEvent(event => {
    const end = terminalOf(event)
    if (!end || ended.has(end.jobId)) return
    ended.set(end.jobId, end)
    check()
  })
  try {
    const requests =
      'itemIds' in scope
        ? [{ itemIds: [...scope.itemIds], ai: true }]
        : scope.libraryIds.map(libraryId => ({ libraryId, ai: true }))
    const accepted = await Promise.all(requests.map(r => bridge.identify(r)))
    wanted = [...new Set(accepted.map(a => a.jobId))]
    check()
    await allDone
    return sumProgress(wanted.map(id => ended.get(id)!))
  } finally {
    off()
  }
}
