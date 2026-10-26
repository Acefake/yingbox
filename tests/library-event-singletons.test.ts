/**
 * 模块级单例（useLibraries / useWriter）的引擎事件订阅不绑第一个调用者的作用域：
 * 设置页里的写出分组先调用 useWriter、随后关掉设置，片库页之后照样收到 writer-progress。
 */
import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { LibraryEvent } from '../src/shared/library/ipc'

const subscribers = new Set<(event: LibraryEvent) => void>()
const bridge = {
  listLibraries: async () => [],
  subscribe: (listener: (event: LibraryEvent) => void) => {
    subscribers.add(listener)
    return () => subscribers.delete(listener)
  },
  writer: {},
}
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => bridge,
  writerBridge: () => bridge.writer,
  errorText: (e: unknown) => String(e),
}))
vi.mock('../src/renderer/src/features/library/settings/folder-picker', () => ({
  pickLibraryFolder: vi.fn(),
}))
vi.mock('../src/renderer/src/components/ui', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const { useWriter } =
  await import('../src/renderer/src/features/library/writer/use-writer')
const { useIdentifyActivity } =
  await import('../src/renderer/src/features/library/state/use-libraries')
const { onLibraryEvent } =
  await import('../src/renderer/src/features/library/state/library-events')

const emit = (event: LibraryEvent): void =>
  subscribers.forEach(listener => listener(event))

describe('片库事件单例订阅', () => {
  it('第一个调用 useWriter 的组件卸载后，写出进度仍然更新', () => {
    const first = effectScope()
    first.run(() => useWriter())
    first.stop()
    const writer = useWriter()
    emit({
      type: 'writer-progress',
      jobId: 3,
      mode: 'write',
      total: 4,
      done: 1,
      written: 1,
      skipped: 0,
      failed: 0,
      finished: false,
    })
    expect(writer.progress.value).toMatchObject({ jobId: 3, done: 1 })
  })

  it('第一个调用 useIdentifyActivity 的组件卸载后，识别进度仍然更新', () => {
    const first = effectScope()
    first.run(() => useIdentifyActivity())
    first.stop()
    const identifying = useIdentifyActivity()
    emit({
      type: 'identify-progress',
      jobId: 1,
      mode: 'identify',
      libraryId: null,
      total: 10,
      done: 4,
      matched: 0,
      review: 0,
      unmatched: 0,
      failed: 0,
      finished: false,
    })
    expect(identifying.value?.progress).toBe(0.4)
  })

  it('组件里的 onLibraryEvent 仍随作用域退订', () => {
    const seen: LibraryEvent[] = []
    const scope = effectScope()
    scope.run(() => onLibraryEvent(event => seen.push(event)))
    scope.stop()
    emit({ type: 'libraries-changed', libraries: [] })
    expect(seen).toEqual([])
  })
})
