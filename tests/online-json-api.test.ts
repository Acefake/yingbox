import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OnlineTransportError,
  getJson,
} from '../src/renderer/src/features/online/api/online'

afterEach(() => vi.unstubAllGlobals())

describe('在线 JSON 请求边界', () => {
  it('还原成功数据，并将源失败交给调用方显示而非伪装空列表', async () => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { api: { online: { getJson: invoke } } })
    invoke.mockResolvedValueOnce({ success: true, data: { list: [] } })
    await expect(getJson('https://site.test/ok')).resolves.toEqual({ list: [] })
    invoke.mockResolvedValueOnce({ success: false, error: 'HTTP 403' })
    await expect(getJson('https://site.test/down')).rejects.toThrow('HTTP 403')
    invoke.mockRejectedValueOnce(new Error('后台已退出'))
    await expect(getJson('https://site.test/ok')).rejects.toBeInstanceOf(
      OnlineTransportError
    )
  })
})
