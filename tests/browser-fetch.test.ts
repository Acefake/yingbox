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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserFetch, resetBrowserFetch } from '../src/main/browser-fetch'

const page = (text: string): string =>
  `<html><body>${text}${'.'.repeat(600)}</body></html>`
const challenge = `<html><body>Just a moment${'.'.repeat(600)}</body></html>`

const blocked = readFileSync(
  join(__dirname, 'fixtures/cloudflare/blocked-4k-av.html'),
  'utf-8'
)

beforeEach(() => {
  resetBrowserFetch()
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

  it('硬封锁页：窗口从不显示、立即销毁，返回空串', async () => {
    state.pages.push([blocked])
    const started = Date.now()
    expect(await browserFetch('https://4k-av.test/s?q=1', 3000)).toBe('')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(state.windows[0]).toMatchObject({ shown: false, destroyed: true })
  })

  it('被封主机熔断：同主机后续请求不开窗口；resetBrowserFetch 后恢复', async () => {
    state.pages.push([blocked], [page('again')])
    await browserFetch('https://4k-av.test/a', 0)
    expect(await browserFetch('https://4k-av.test/b', 0)).toBe('')
    expect(state.windows).toHaveLength(1)
    resetBrowserFetch('4k-av.test')
    expect(await browserFetch('https://4k-av.test/b', 0)).toContain('again')
    expect(state.windows).toHaveLength(2)
  })

  it('排队中的同主机请求在前一个被封后不再开窗口', async () => {
    state.pages.push([blocked], [page('x')], [page('y')])
    const results = await Promise.all([
      browserFetch('https://4k-av.test/1', 0),
      browserFetch('https://4k-av.test/2', 0),
      browserFetch('https://other.test/3', 0),
    ])
    expect(results[0]).toBe('')
    expect(results[1]).toBe('')
    expect(results[2]).toContain('x')
    expect(state.windows).toHaveLength(2)
  })

  it('熔断中的主机不排队：前面有慢请求时也立即返回', async () => {
    state.pages.push([blocked], [challenge, page('slow')])
    await browserFetch('https://4k-av.test/a', 0)
    const slow = browserFetch('https://slow.test/x', 3000)
    const started = Date.now()
    expect(await browserFetch('https://4k-av.test/b', 0)).toBe('')
    expect(Date.now() - started).toBeLessThan(300)
    expect(await slow).toContain('slow')
  })

  it('挑战途中跳到封锁页：不等满时限立即收起', async () => {
    state.pages.push([challenge, blocked])
    const started = Date.now()
    expect(await browserFetch('https://cf.test/x', 10000)).toBe('')
    expect(Date.now() - started).toBeLessThan(3000)
    expect(state.windows[0].destroyed).toBe(true)
  })

  it('同一地址并发请求只开一个窗口、共用结果', async () => {
    state.pages.push([page('shared')], [page('second')])
    const [a, b] = await Promise.all([
      browserFetch('https://same.test/p', 0),
      browserFetch('https://same.test/p', 0),
    ])
    expect(a).toContain('shared')
    expect(b).toBe(a)
    expect(state.windows).toHaveLength(1)
  })

  it('挑战连续 3 次没过：该主机熔断，不再弹窗', async () => {
    state.pages.push([challenge], [challenge], [challenge], [page('no')])
    for (let i = 0; i < 4; i++) await browserFetch(`https://cf.test/${i}`, 0)
    expect(state.windows).toHaveLength(3)
  })
})
