import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 每个假窗口按 pages 队列依次返回 HTML；记录创建、显示、销毁。 */
const state = vi.hoisted(() => ({
  pages: [] as string[][],
  windows: [] as Array<{ shown: boolean; destroyed: boolean; url: string }>,
  active: 0,
  maxActive: 0,
}))

vi.mock('electron', () => {
  class FakeWindow {
    private record = { shown: false, destroyed: false, url: '' }
    private html: string[]
    webContents: unknown
    constructor() {
      this.html = state.pages.shift() ?? ['']
      state.windows.push(this.record)
      state.active++
      state.maxActive = Math.max(state.maxActive, state.active)
      const record = this.record
      const html = this.html
      this.webContents = {
        setUserAgent: () => {},
        setWindowOpenHandler: () => {},
        once: () => {},
        removeListener: () => {},
        getURL: () => record.url,
        mainFrame: {
          executeJavaScript: async () =>
            html.length > 1 ? html.shift() : html[0],
        },
      }
    }
    async loadURL(url: string): Promise<void> {
      this.record.url = url
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    isDestroyed(): boolean {
      return this.record.destroyed
    }
    isVisible(): boolean {
      return this.record.shown
    }
    showInactive(): void {
      this.record.shown = true
    }
    destroy(): void {
      this.record.destroyed = true
      state.active--
    }
  }
  return {
    BrowserWindow: FakeWindow,
    screen: {
      getPrimaryDisplay: () => {
        throw new Error('headless')
      },
    },
    session: { fromPartition: () => ({ setUserAgent: () => {} }) },
  }
})

import { browserFetch } from '../src/main/browser-fetch'

const page = (text: string): string =>
  `<html><body>${text}${'.'.repeat(600)}</body></html>`
const challenge = `<html><body>Just a moment${'.'.repeat(600)}</body></html>`

beforeEach(() => {
  state.pages = []
  state.windows = []
  state.active = 0
  state.maxActive = 0
})

describe('browserFetch', () => {
  it('普通页面直接返回 HTML，窗口不显示且用后销毁', async () => {
    state.pages.push([page('ok')])
    const html = await browserFetch('https://example.com/a', 0)
    expect(html).toContain('ok')
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0]).toMatchObject({ shown: false, destroyed: true })
  })

  it('命中挑战页时显示窗口并等到挑战通过', async () => {
    state.pages.push([challenge, page('passed')])
    const html = await browserFetch('https://example.com/cf', 3000)
    expect(html).toContain('passed')
    expect(state.windows[0]).toMatchObject({ shown: true, destroyed: true })
  })

  it('挑战未通过返回空串', async () => {
    state.pages.push([challenge])
    expect(await browserFetch('https://example.com/cf', 0)).toBe('')
    expect(state.windows[0].destroyed).toBe(true)
  })

  it('非 http(s) 地址不开窗口', async () => {
    expect(await browserFetch('file:///etc/passwd')).toBe('')
    expect(await browserFetch('not a url')).toBe('')
    expect(state.windows).toHaveLength(0)
  })

  it('并发请求串行执行，同一时刻只有一个窗口', async () => {
    state.pages.push([page('1')], [page('2')], [page('3')])
    const results = await Promise.all(
      ['1', '2', '3'].map(n => browserFetch(`https://example.com/${n}`, 0))
    )
    expect(results.map(r => r.includes(page('').slice(0, 10)))).toEqual([
      true,
      true,
      true,
    ])
    expect(results[2]).toContain('3')
    expect(state.maxActive).toBe(1)
  })

  it('一次失败不卡住后续请求', async () => {
    state.pages.push([challenge], [page('next')])
    expect(await browserFetch('https://example.com/x', 0)).toBe('')
    expect(await browserFetch('https://example.com/y', 0)).toContain('next')
  })
})
