import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import {
  installWindowSecurity,
  isExternalWebUrl,
} from '../src/main/window-security'

describe('主窗口导航边界', () => {
  it('系统浏览器只接收无凭据的 HTTP(S) URL', () => {
    for (const url of ['https://example.com', 'http://example.com'])
      expect(isExternalWebUrl(url)).toBe(true)
    for (const url of [
      'file:///tmp/a',
      'javascript:alert(1)',
      'yingbox-stream://fetch/',
      'custom-app://open',
      'https://user:pass@example.com',
      'invalid',
    ])
      expect(isExternalWebUrl(url)).toBe(false)
  })
  it('阻止主框架与子框架自行导航，阻止弹窗并只转交合法链接', () => {
    const listeners = new Map<
      string,
      (event: { preventDefault: () => void }) => void
    >()
    let popup!: Parameters<WebContents['setWindowOpenHandler']>[0]
    const contents = {
      on: (name: string, fn: (event: { preventDefault: () => void }) => void) =>
        listeners.set(name, fn),
      setWindowOpenHandler: (handler: typeof popup) => {
        popup = handler
      },
    } as unknown as WebContents
    const open = vi.fn(async () => {})
    installWindowSecurity(contents, open)
    for (const name of ['will-navigate', 'will-frame-navigate']) {
      const preventDefault = vi.fn()
      listeners.get(name)!({ preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    for (const url of ['file:///etc/passwd', 'https://example.com']) {
      expect(popup({ url } as Electron.HandlerDetails)).toEqual({
        action: 'deny',
      })
    }
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com')
  })
})
