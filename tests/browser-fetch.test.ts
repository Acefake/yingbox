import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 假 Electron：每个假窗口按 pages 队列依次返回 HTML，记录创建、显示、销毁与 UA；
 * 假 session.fetch 按 responses 队列依次应答（Error 表示网络失败），记录每次调用。
 */
const state = vi.hoisted(() => ({
  pages: [] as string[][],
  windows: [] as Array<{
    shown: boolean
    destroyed: boolean
    url: string
    ua: string
  }>,
  active: 0,
  maxActive: 0,
  responses: [] as Array<{ status: number; body: string } | Error>,
  fetches: [] as Array<{ url: string; init: RequestInit; partition: string }>,
  fetchDelayMs: 5,
}))

vi.mock('electron', () => {
  class FakeWindow {
    private record = { shown: false, destroyed: false, url: '', ua: '' }
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
        setUserAgent: (ua: string) => {
          record.ua = ua
        },
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
  const fromPartition = (partition: string): unknown => ({
    setUserAgent: () => {},
    fetch: async (url: string, init: RequestInit) => {
      state.fetches.push({ url, init, partition })
      await new Promise(resolve => setTimeout(resolve, state.fetchDelayMs))
      const next = state.responses.shift()
      if (!next) throw new Error(`unexpected session.fetch ${url}`)
      if (next instanceof Error) throw next
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: async () => next.body,
      }
    },
  })
  return {
    BrowserWindow: FakeWindow,
    screen: {
      getPrimaryDisplay: () => {
        throw new Error('headless')
      },
    },
    session: { fromPartition },
  }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BrowserFetchOptions,
  type BrowserFetcher,
  createBrowserFetch,
} from '../src/main/browser-fetch'

const page = (text: string): string =>
  `<html><body>${text}${'.'.repeat(600)}</body></html>`
const challenge = `<html><body>Just a moment${'.'.repeat(600)}</body></html>`

const blocked = readFileSync(
  join(__dirname, 'fixtures/cloudflare/blocked-4k-av.html'),
  'utf-8'
)

/** 每个用例一个独立实例；默认挑战等 0 毫秒（没过就算失败），时钟可拨。 */
let clock = 0
const make = (options: BrowserFetchOptions = {}): BrowserFetcher =>
  createBrowserFetch({ challengeWaitMs: 0, now: () => clock, ...options })

beforeEach(() => {
  clock = 1_000_000
  state.pages = []
  state.windows = []
  state.active = 0
  state.maxActive = 0
  state.responses = []
  state.fetches = []
  state.fetchDelayMs = 5
})

describe('browserFetch：窗口流程', () => {
  it('普通页面直接返回 HTML，窗口不显示且用后销毁', async () => {
    const { browserFetch } = make()
    state.pages.push([page('ok')])
    const html = await browserFetch('https://example.com/a')
    expect(html).toContain('ok')
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0]).toMatchObject({ shown: false, destroyed: true })
    expect(state.fetches).toHaveLength(0)
  })

  it('命中挑战页时显示窗口并等到挑战通过', async () => {
    const { browserFetch } = make({ challengeWaitMs: 3000 })
    state.pages.push([challenge, page('passed')])
    const html = await browserFetch('https://example.com/cf')
    expect(html).toContain('passed')
    expect(state.windows[0]).toMatchObject({ shown: true, destroyed: true })
  })

  it('挑战未通过返回空串', async () => {
    const { browserFetch } = make()
    state.pages.push([challenge])
    expect(await browserFetch('https://example.com/cf')).toBe('')
    expect(state.windows[0].destroyed).toBe(true)
  })

  it('非 http(s) 地址不开窗口', async () => {
    const { browserFetch } = make()
    expect(await browserFetch('file:///etc/passwd')).toBe('')
    expect(await browserFetch('not a url')).toBe('')
    expect(state.windows).toHaveLength(0)
    expect(state.fetches).toHaveLength(0)
  })

  it('并发请求串行执行，同一时刻只有一个窗口', async () => {
    const { browserFetch } = make()
    state.pages.push([page('1')], [page('2')], [page('3')])
    const results = await Promise.all(
      ['1', '2', '3'].map(n => browserFetch(`https://h${n}.test/${n}`))
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
    const { browserFetch } = make()
    state.pages.push([challenge], [page('next')])
    expect(await browserFetch('https://example.com/x')).toBe('')
    expect(await browserFetch('https://example.com/y')).toContain('next')
  })

  it('硬封锁页：窗口从不显示、立即销毁，返回空串', async () => {
    const { browserFetch } = make({ challengeWaitMs: 3000 })
    state.pages.push([blocked])
    const started = Date.now()
    expect(await browserFetch('https://4k-av.test/s?q=1')).toBe('')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(state.windows[0]).toMatchObject({ shown: false, destroyed: true })
  })

  it('被封主机熔断：同主机后续请求不开窗口；resetBrowserFetch 后恢复', async () => {
    const { browserFetch, resetBrowserFetch } = make()
    state.pages.push([blocked], [page('again')])
    await browserFetch('https://4k-av.test/a')
    expect(await browserFetch('https://4k-av.test/b')).toBe('')
    expect(state.windows).toHaveLength(1)
    resetBrowserFetch('4k-av.test')
    expect(await browserFetch('https://4k-av.test/b')).toContain('again')
    expect(state.windows).toHaveLength(2)
  })

  it('排队中的同主机请求在前一个被封后不再开窗口', async () => {
    const { browserFetch } = make()
    state.pages.push([blocked], [page('x')], [page('y')])
    const results = await Promise.all([
      browserFetch('https://4k-av.test/1'),
      browserFetch('https://4k-av.test/2'),
      browserFetch('https://other.test/3'),
    ])
    expect(results[0]).toBe('')
    expect(results[1]).toBe('')
    expect(results[2]).toContain('x')
    expect(state.windows).toHaveLength(2)
  })

  it('熔断中的主机不排队：前面有慢请求时也立即返回', async () => {
    const { browserFetch } = make({ challengeWaitMs: 3000 })
    state.pages.push([blocked], [challenge, page('slow')])
    await browserFetch('https://4k-av.test/a')
    const slow = browserFetch('https://slow.test/x')
    const started = Date.now()
    expect(await browserFetch('https://4k-av.test/b')).toBe('')
    expect(Date.now() - started).toBeLessThan(300)
    expect(await slow).toContain('slow')
  })

  it('挑战途中跳到封锁页：不等满时限立即收起', async () => {
    const { browserFetch } = make({ challengeWaitMs: 10000 })
    state.pages.push([challenge, blocked])
    const started = Date.now()
    expect(await browserFetch('https://cf.test/x')).toBe('')
    expect(Date.now() - started).toBeLessThan(3000)
    expect(state.windows[0].destroyed).toBe(true)
  })

  it('同一地址并发请求只开一个窗口、共用结果', async () => {
    const { browserFetch } = make()
    state.pages.push([page('shared')], [page('second')])
    const [a, b] = await Promise.all([
      browserFetch('https://same.test/p'),
      browserFetch('https://same.test/p'),
    ])
    expect(a).toContain('shared')
    expect(b).toBe(a)
    expect(state.windows).toHaveLength(1)
  })

  it('挑战连续 3 次没过：该主机熔断，不再弹窗', async () => {
    const { browserFetch } = make()
    state.pages.push([challenge], [challenge], [challenge], [page('no')])
    for (let i = 0; i < 4; i++) await browserFetch(`https://cf.test/${i}`)
    expect(state.windows).toHaveLength(3)
  })
})

describe('browserFetch：过过挑战的主机先用会话直接取页', () => {
  /** 先让窗口在 cf.test 上过一次挑战，留下「最近过挑战时间」。 */
  const pass = async (bf: BrowserFetcher): Promise<void> => {
    state.pages.push([page('first')])
    expect(await bf.browserFetch('https://cf.test/first')).toContain('first')
    state.windows = []
  }

  it('快路径命中：同主机后续请求用同一 partition 的 session.fetch，不开窗口', async () => {
    const bf = make()
    state.pages.push([page('first')])
    await bf.browserFetch('https://cf.test/first')
    const windowUa = state.windows[0].ua
    state.responses.push({ status: 200, body: page('fast') })
    const html = await bf.browserFetch('https://cf.test/next')
    expect(html).toContain('fast')
    expect(state.windows).toHaveLength(1)
    expect(state.fetches).toHaveLength(1)
    const [call] = state.fetches
    expect(call.url).toBe('https://cf.test/next')
    expect(call.partition).toBe('persist:yingbox-browser-fetch')
    expect(call.init.credentials).toBe('include')
    const headers = new Headers(call.init.headers)
    expect(windowUa).not.toBe('')
    expect(headers.get('user-agent')).toBe(windowUa)
  })

  it('没过过挑战的主机不走快路径；窗口挑战没过也不记', async () => {
    const bf = make()
    state.pages.push([challenge], [page('second')])
    expect(await bf.browserFetch('https://cf.test/a')).toBe('')
    expect(await bf.browserFetch('https://cf.test/b')).toContain('second')
    expect(state.fetches).toHaveLength(0)
    expect(state.windows).toHaveLength(2)
  })

  it('记录只对同一主机有效', async () => {
    const bf = make()
    await pass(bf)
    state.pages.push([page('other')])
    expect(await bf.browserFetch('https://other.test/x')).toContain('other')
    expect(state.fetches).toHaveLength(0)
    expect(state.windows).toHaveLength(1)
  })

  it('挑战回退：会话拿到挑战页就退回开窗口，窗口过了重新记时', async () => {
    const bf = make()
    await pass(bf)
    state.responses.push({ status: 403, body: challenge })
    state.pages.push([page('window')])
    expect(await bf.browserFetch('https://cf.test/a')).toContain('window')
    expect(state.fetches).toHaveLength(1)
    expect(state.windows).toHaveLength(1)
    state.responses.push({ status: 200, body: page('fast-again') })
    expect(await bf.browserFetch('https://cf.test/b')).toContain('fast-again')
    expect(state.windows).toHaveLength(1)
  })

  it('挑战回退后窗口也没过：记录作废，下一次直接开窗口', async () => {
    const bf = make()
    await pass(bf)
    state.responses.push({ status: 403, body: challenge })
    state.pages.push([challenge], [page('later')])
    expect(await bf.browserFetch('https://cf.test/a')).toBe('')
    expect(await bf.browserFetch('https://cf.test/b')).toContain('later')
    expect(state.fetches).toHaveLength(1)
    expect(state.windows).toHaveLength(2)
  })

  it('过期回退：过挑战超过 25 分钟后不再用会话，直接开窗口', async () => {
    const bf = make()
    await pass(bf)
    clock += 24 * 60_000
    state.responses.push({ status: 200, body: page('still-fresh') })
    expect(await bf.browserFetch('https://cf.test/a')).toContain('still-fresh')
    clock += 2 * 60_000
    state.pages.push([page('expired')])
    expect(await bf.browserFetch('https://cf.test/b')).toContain('expired')
    expect(state.fetches).toHaveLength(1)
    expect(state.windows).toHaveLength(1)
  })

  it('会话取页成功不续期：时间从窗口过挑战那一刻算', async () => {
    const bf = make()
    await pass(bf)
    clock += 20 * 60_000
    state.responses.push({ status: 200, body: page('fast') })
    await bf.browserFetch('https://cf.test/a')
    clock += 6 * 60_000
    state.pages.push([page('window')])
    expect(await bf.browserFetch('https://cf.test/b')).toContain('window')
    expect(state.fetches).toHaveLength(1)
  })

  it('硬封锁熔断不变：会话拿到封锁页立即熔断，不开窗口、之后不再请求', async () => {
    const bf = make()
    await pass(bf)
    state.responses.push({ status: 403, body: blocked })
    expect(await bf.browserFetch('https://cf.test/a')).toBe('')
    expect(state.windows).toHaveLength(0)
    expect(await bf.browserFetch('https://cf.test/b')).toBe('')
    expect(state.fetches).toHaveLength(1)
    expect(state.windows).toHaveLength(0)
  })

  it('会话请求出错或不是正常页（非 2xx、空白页）：退回开窗口', async () => {
    const bf = make()
    await pass(bf)
    state.responses.push(new Error('net::ERR_CONNECTION_RESET'))
    state.pages.push([page('w1')])
    expect(await bf.browserFetch('https://cf.test/a')).toContain('w1')
    state.responses.push({ status: 500, body: page('server error') })
    state.pages.push([page('w2')])
    expect(await bf.browserFetch('https://cf.test/b')).toContain('w2')
    state.responses.push({ status: 200, body: '<html></html>' })
    state.pages.push([page('w3')])
    expect(await bf.browserFetch('https://cf.test/c')).toContain('w3')
    expect(state.fetches).toHaveLength(3)
    expect(state.windows).toHaveLength(3)
  })

  it('快路径不排队：另一主机的窗口正在等挑战时也立即返回', async () => {
    const bf = make({ challengeWaitMs: 3000 })
    await pass(bf)
    state.pages.push([challenge, page('slow')])
    const slow = bf.browserFetch('https://slow.test/x')
    state.responses.push({ status: 200, body: page('fast') })
    const started = Date.now()
    expect(await bf.browserFetch('https://cf.test/a')).toContain('fast')
    expect(Date.now() - started).toBeLessThan(300)
    expect(await slow).toContain('slow')
  })

  it('同主机的会话请求可以并发', async () => {
    const bf = make()
    await pass(bf)
    state.fetchDelayMs = 50
    state.responses.push(
      { status: 200, body: page('a') },
      { status: 200, body: page('b') },
      { status: 200, body: page('c') }
    )
    const started = Date.now()
    const results = await Promise.all(
      ['a', 'b', 'c'].map(p => bf.browserFetch(`https://cf.test/${p}`))
    )
    expect(Date.now() - started).toBeLessThan(140)
    expect(results.every(r => r.length > 0)).toBe(true)
    expect(state.windows).toHaveLength(0)
  })

  it('同主机并发撞挑战只开一个窗口：排在后面的在窗口过了之后改走会话', async () => {
    const bf = make()
    await pass(bf)
    state.responses.push(
      { status: 403, body: challenge },
      { status: 403, body: challenge },
      { status: 200, body: page('b-fast') }
    )
    state.pages.push([page('a-window')], [page('b-window')])
    const [a, b] = await Promise.all([
      bf.browserFetch('https://cf.test/a'),
      bf.browserFetch('https://cf.test/b'),
    ])
    expect(a).toContain('a-window')
    expect(b).toContain('b-fast')
    expect(state.windows).toHaveLength(1)
    expect(state.fetches.map(f => f.url)).toEqual([
      'https://cf.test/a',
      'https://cf.test/b',
      'https://cf.test/b',
    ])
  })
})
