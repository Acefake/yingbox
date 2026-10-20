/**
 * 引擎事件的单一订阅：整个渲染进程只开一个 MessagePort，按需分发给各组件。
 *
 * 第一个监听者出现时订阅，最后一个离开时退订。
 */
import { getCurrentScope, onScopeDispose } from 'vue'

import type { LibraryEvent } from '../../../../../shared/library/ipc'
import { libraryBridge } from '../api/bridge'
import type { WriterProgressEvent } from '../writer/writer-contract'

/**
 * 界面处理的事件：引擎事件 + P5 的 writer-progress。
 * TODO(P5)：合并后 LibraryEvent 自带 WriterProgressEvent，这里直接用 LibraryEvent。
 */
export type LibraryUiEvent = LibraryEvent | WriterProgressEvent

type Listener = (event: LibraryUiEvent) => void

const listeners = new Set<Listener>()
let unsubscribe: (() => void) | null = null

function dispatch(event: LibraryUiEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[library] 事件处理失败', error)
    }
  }
}

/** 监听引擎事件，返回取消函数；在组件 / effectScope 里调用时随作用域自动取消。 */
export function onLibraryEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (!unsubscribe) {
    const bridge = libraryBridge()
    if (bridge) {
      unsubscribe = bridge.subscribe(event => dispatch(event))
    }
  }
  const off = (): void => {
    listeners.delete(listener)
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
  if (getCurrentScope()) onScopeDispose(off)
  return off
}
