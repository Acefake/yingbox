import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createFfmpegCache } from '../src/main/capture/ffmpeg-cache'

const userData = mkdtempSync(join(tmpdir(), 'yb-tools-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

describe('截图的 ffmpeg 路径缓存', () => {
  it('找到后沿用，作废后重新探测', () => {
    let found = '/old/ffmpeg'
    let probes = 0
    const cache = createFfmpegCache(() => {
      probes++
      return found
    }, 60_000)
    expect(cache.get()).toBe('/old/ffmpeg')
    expect(cache.get()).toBe('/old/ffmpeg')
    expect(probes).toBe(1)
    found = '/new/ffmpeg'
    cache.invalidate()
    expect(cache.get()).toBe('/new/ffmpeg')
    expect(probes).toBe(2)
  })

  it('没找到只缓存一段时间；探测抛错按没找到处理', () => {
    let now = 0
    let probes = 0
    const cache = createFfmpegCache(
      () => {
        probes++
        if (probes === 1) throw new Error('boom')
        return '/usr/bin/ffmpeg'
      },
      60_000,
      () => now
    )
    expect(cache.get()).toBe('')
    now = 59_999
    expect(cache.get()).toBe('')
    expect(probes).toBe(1)
    now = 60_000
    expect(cache.get()).toBe('/usr/bin/ffmpeg')
    expect(probes).toBe(2)
  })

  it('设置里改工具路径（setPathOverrides）会通知订阅者', async () => {
    const { onPathOverridesChange, setPathOverrides } =
      await import('../src/main/plugins/lada/tools')
    const listener = vi.fn()
    const off = onPathOverridesChange(listener)
    await setPathOverrides({ ffmpeg: '' })
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    await setPathOverrides({ ffmpeg: '' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('路径无效时不通知（覆盖值没变）', async () => {
    const { onPathOverridesChange, setPathOverrides } =
      await import('../src/main/plugins/lada/tools')
    const listener = vi.fn()
    onPathOverridesChange(listener)
    await expect(setPathOverrides({ ffmpeg: 'relative' })).rejects.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
