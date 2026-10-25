/**
 * 追更总览的共享副本：面板和日历标记同时使用时只订阅一次，最后一个离开才退订
 * （preload 的 offChanged 会移除通道上的全部监听）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = {
  overview: vi.fn(async () => ({ episodes: [] })),
  onChanged: vi.fn(),
  offChanged: vi.fn(),
}
vi.mock('../src/renderer/src/features/autograb/api', () => ({
  autograbAvailable: true,
  autograbApi: () => bridge,
}))

const { autograbStore } =
  await import('../src/renderer/src/features/autograb/autograb-store')

afterEach(() => vi.clearAllMocks())

describe('追更总览共享副本', () => {
  it('两个使用者只订阅一次（各取一次最新）；一个离开不退订，都离开才退订', async () => {
    const releasePanel = autograbStore.acquire()
    const releaseCalendar = autograbStore.acquire()
    expect(bridge.onChanged).toHaveBeenCalledTimes(1)
    expect(bridge.overview).toHaveBeenCalledTimes(2)
    releasePanel()
    releasePanel()
    expect(bridge.offChanged).not.toHaveBeenCalled()
    releaseCalendar()
    expect(bridge.offChanged).toHaveBeenCalledTimes(1)
  })

  it('changed 短时间内多次只取一次', async () => {
    vi.useFakeTimers()
    const release = autograbStore.acquire()
    const onChanged = bridge.onChanged.mock.calls[0][0] as () => void
    bridge.overview.mockClear()
    onChanged()
    onChanged()
    onChanged()
    await vi.advanceTimersByTimeAsync(350)
    expect(bridge.overview).toHaveBeenCalledTimes(1)
    release()
    vi.useRealTimers()
  })
})
