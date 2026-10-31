import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { vod } = vi.hoisted(() => ({ vod: vi.fn() }))
vi.mock('../src/renderer/src/features/online/api/online', () => ({
  onlineApi: () => ({ vod, resetBlocks: async () => {} }),
}))
import { checkStartupPlugin } from '../src/renderer/src/features/online/composables/startup-plugin-check'
import {
  pluginProbeStates,
  pluginRowProps,
  retryAllPlugins,
} from '../src/renderer/src/features/online/composables/plugin-health'
const site = {
  name: '测试插件',
  api: 'csp_fixture',
  ext: 'fixture.js',
  type: 3 as const,
}
beforeEach(() => {
  vod.mockReset()
})
afterEach(async () => {
  await retryAllPlugins()
  vi.useRealTimers()
})
describe('插件后台启动检测', () => {
  it.each([{ list: [] }, { data: { list: [] } }, JSON.stringify({ list: [] })])(
    '接受空的真实列表并使用无交互模式：%j',
    async data => {
      vod.mockResolvedValue({ success: true, data })
      expect(await checkStartupPlugin(site, () => true)).toBe(true)
      expect(vod).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search',
          background: true,
          keyword: '电影',
        })
      )
      expect(pluginRowProps(site.name).status).toBe('ok')
    }
  )
  it.each([{}, null, { list: '错误页' }])('拒绝无效响应：%j', async data => {
    vod.mockResolvedValue({ success: true, data })
    expect(await checkStartupPlugin(site, () => true)).toBe(false)
    expect(pluginRowProps(site.name)).toMatchObject({
      status: 'fail',
      note: '插件响应缺少列表',
    })
  })
  it('超时后关闭来源，迟到的成功不覆盖结果', async () => {
    vi.useFakeTimers()
    let finish!: (response: unknown) => void
    vod.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = checkStartupPlugin(site, () => true, 100)
    expect(pluginRowProps(site.name)).toMatchObject({
      status: 'checking',
      checking: true,
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(false)
    finish({ success: true, data: { list: [] } })
    await Promise.resolve()
    expect(pluginRowProps(site.name).status).toBe('fail')
  })
  it('后台连接失败不等同源失效，不修改开关', async () => {
    vod.mockRejectedValue(new Error('IPC 已关闭'))
    expect(await checkStartupPlugin(site, () => true)).toBeUndefined()
    expect(pluginRowProps(site.name).status).toBe('unknown')
  })
  it('取消后丢弃迟到的结果与检测状态', async () => {
    let active = true
    let finish!: (response: unknown) => void
    vod.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = checkStartupPlugin(site, () => active)
    active = false
    finish({ success: true, data: { list: [] } })
    expect(await pending).toBeUndefined()
    expect(pluginProbeStates.has(site.name)).toBe(false)
  })
})
