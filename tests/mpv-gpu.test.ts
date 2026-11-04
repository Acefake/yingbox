import { beforeEach, expect, it, vi } from 'vitest'
const { getGPUInfo } = vi.hoisted(() => ({ getGPUInfo: vi.fn() }))
vi.mock('electron', () => ({ app: { getGPUInfo } }))
import { probeNvidiaGpu } from '../src/main/mpv-gpu'

beforeEach(() => {
  getGPUInfo.mockReset()
})

it('枚举到 NVIDIA 设备仅证明设备存在', async () => {
  getGPUInfo.mockResolvedValue({
    gpuDevice: [{ vendorId: 0x1002 }, { vendorId: 0x10de }],
  })
  expect(await probeNvidiaGpu()).toBe(true)
})
it('已知非 NVIDIA 与未知数据分开', async () => {
  getGPUInfo.mockResolvedValue({ gpuDevice: [{ vendorId: 0x1002 }] })
  expect(await probeNvidiaGpu()).toBe(false)
  for (const info of [null, {}, { gpuDevice: [] }, { gpuDevice: [{}] }]) {
    getGPUInfo.mockResolvedValue(info)
    expect(await probeNvidiaGpu()).toBeNull()
  }
})
it('枚举失败不阻止普通播放', async () => {
  getGPUInfo.mockRejectedValue(new Error('GPU query failed'))
  expect(await probeNvidiaGpu()).toBeNull()
})

it('GPU 枚举卡住时有等待上限', async () => {
  vi.useFakeTimers()
  try {
    getGPUInfo.mockReturnValue(new Promise(() => {}))
    const pending = probeNvidiaGpu()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})
