// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
const { search, status } = vi.hoisted(() => ({
  search: vi.fn(),
  status: vi.fn(),
}))
vi.mock('../../../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ visual: { search, status } }),
  errorText: (error: Error) => error.message,
}))
import { useVisualSearch } from '../../../src/renderer/src/features/library/visual/use-visual-search'
import { visualSearchSource } from '../../../src/renderer/src/features/library/visual/visual-source'
let app: App | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  visualSearchSource.value = 'all'
  search.mockResolvedValue([])
  status.mockResolvedValue({
    runtime: true,
    model: 'ready',
    indexed: 1,
    indexing: false,
    frames: { running: false },
  })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
  document.body.innerHTML = ''
})
it('快速切换范围只发最后一次查询，关闭再打开不重复执行残留的防抖任务', async () => {
  const open = ref(true)
  let state!: ReturnType<typeof useVisualSearch>
  app = createApp({
    setup() {
      state = useVisualSearch({ open, libraryId: () => undefined })
      return () => h('div')
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  state.text.value = '海边'
  visualSearchSource.value = 'image'
  visualSearchSource.value = 'video'
  await vi.advanceTimersByTimeAsync(299)
  expect(search).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(search).toHaveBeenCalledTimes(1)
  expect(search.mock.lastCall?.[0].source).toBe('video')
  state.text.value = '雪地'
  open.value = false
  await nextTick()
  open.value = true
  await nextTick()
  await vi.advanceTimersByTimeAsync(350)
  expect(search).toHaveBeenCalledTimes(2)
})
