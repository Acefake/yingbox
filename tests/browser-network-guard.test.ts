import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
vi.mock('electron', () => ({ session: {} }))
import { installBrowserNetworkGuard } from '../src/main/browser-fetch/network-guard'

describe('代抓窗口网络限制', () => {
  it('每次请求都拒绝内网、非 HTTP(S)、凭据和 DNS 失败；重复安装不覆盖监听器', async () => {
    type Listener = (
      details: { url: string },
      callback: (result: { cancel?: boolean }) => void
    ) => void
    let listener!: Listener
    const onBeforeRequest = vi.fn((_filter: unknown, fn: Listener) => {
      listener = fn
    })
    const target = {
      webRequest: { onBeforeRequest },
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    } as unknown as Session
    installBrowserNetworkGuard(target, async host => {
      if (host === 'missing.test') throw new Error('DNS failed')
      return [
        { address: host === 'internal.test' ? '10.0.0.1' : '93.184.216.34' },
      ]
    })
    installBrowserNetworkGuard(target)
    expect(onBeforeRequest).toHaveBeenCalledTimes(1)
    for (const url of [
      'http://127.0.0.1/private',
      'http://internal.test/x',
      'file:///etc/passwd',
      'https://u:p@public.test',
      'https://missing.test',
    ]) {
      const result = await new Promise(resolve => listener({ url }, resolve))
      expect(result).toEqual({ cancel: true })
    }
    expect(
      await new Promise(resolve =>
        listener({ url: 'https://public.test/challenge.js' }, resolve)
      )
    ).toEqual({ cancel: false })
  })
})
