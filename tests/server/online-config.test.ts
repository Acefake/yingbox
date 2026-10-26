/**
 * 在线板块的服务端配置与可选的浏览器代抓：开关、下载目录、YINGBOX_BROWSER 解析、
 * 没配置时返回空串（引擎降级）、playwright 驱动时的挑战等待与硬封锁熔断。
 */
import { describe, expect, it } from 'vitest'
import {
  type PlaywrightLike,
  type PwRoute,
  createNodeBrowserFetch,
  parseBrowserSpec,
  publicOnlyRoute,
} from '../../src/server/online/browser-fetch'
import { loadOnlineConfig } from '../../src/server/online/config'

const PAGE_OK = `<html><body>${'正文'.repeat(400)}</body></html>`
const PAGE_CHALLENGE =
  '<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>'
const PAGE_BLOCKED =
  '<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>'

/** 假 DNS：*.example 解析到公网地址，*.lan 解析到内网地址。 */
const lookup = async (host: string): Promise<Array<{ address: string }>> => [
  { address: host.endsWith('.lan') ? '192.168.1.20' : '93.184.216.34' },
]

/** 假的被拦请求：记下放行还是中止。 */
function fakeRoute(url: string): PwRoute & { verdict: string } {
  const route = {
    verdict: '',
    request: () => ({ url: () => url }),
    continue: async () => {
      route.verdict = 'continue'
    },
    abort: async (code?: string) => {
      route.verdict = `abort:${code}`
    },
  }
  return route
}

/** 假 playwright：每个地址依次回一组页面内容；goto 先过 context.route 登记的拦截。 */
function fakePlaywright(pages: Record<string, string[]>): {
  pw: PlaywrightLike
  launches: Array<Record<string, unknown>>
} {
  const launches: Array<Record<string, unknown>> = []
  const pw: PlaywrightLike = {
    chromium: {
      async launchPersistentContext(_dir, options) {
        launches.push(options)
        let guard: ((route: PwRoute) => Promise<void>) | null = null
        return {
          async route(_pattern, handler) {
            guard = handler
          },
          async newPage() {
            let url = ''
            return {
              goto: async target => {
                const route = fakeRoute(target)
                await guard?.(route)
                if (route.verdict !== 'continue')
                  throw new Error(`net::ERR_BLOCKED_BY_CLIENT at ${target}`)
                url = target
              },
              content: async () => {
                const list = pages[url] ?? ['']
                return list.length > 1 ? list.shift()! : list[0]
              },
              waitForTimeout: async () => {},
              close: async () => {},
            }
          },
          close: async () => {},
        }
      },
    },
  }
  return { pw, launches }
}

describe('loadOnlineConfig', () => {
  it('默认开启，下载目录在数据目录下，代理不放行内网', () => {
    const config = loadOnlineConfig({}, '/data')
    expect(config.enabled).toBe(true)
    expect(config.downloadDir).toBe('/data/downloads')
    expect(config.engineDir).toBe('/data/engine')
    expect(config.browser).toBeNull()
    expect(config.streamAllowPrivate).toEqual([])
    expect(config.idleMs).toBe(300_000)
  })

  it('读环境变量；写错时启动即失败', () => {
    const config = loadOnlineConfig(
      {
        YINGBOX_ONLINE: 'off',
        YINGBOX_DOWNLOAD_DIR: '/downloads',
        YINGBOX_BROWSER: 'chromium:/usr/bin/chromium',
        YINGBOX_STREAM_ALLOW_PRIVATE: 'NAS.lan, 192.168.1.0/24',
        YINGBOX_ENGINE_IDLE: '0',
      },
      '/data'
    )
    expect(config.enabled).toBe(false)
    expect(config.downloadDir).toBe('/downloads')
    // 关闭在线板块时不解析浏览器配置，写错的旧值也不拦启动
    expect(config.browser).toBeNull()
    expect(
      loadOnlineConfig(
        { YINGBOX_ONLINE: 'off', YINGBOX_BROWSER: 'firefox:/x' },
        '/d'
      ).browser
    ).toBeNull()
    expect(
      loadOnlineConfig({ YINGBOX_BROWSER: 'chromium:/usr/bin/chromium' }, '/d')
        .browser
    ).toEqual({ kind: 'chromium', path: '/usr/bin/chromium' })
    expect(() =>
      loadOnlineConfig({ YINGBOX_BROWSER: 'firefox:/x' }, '/d')
    ).toThrow(/chromium/)
    expect(config.streamAllowPrivate).toEqual(['nas.lan', '192.168.1.0/24'])
    expect(config.idleMs).toBe(0)
    expect(() => loadOnlineConfig({ YINGBOX_ONLINE: 'maybe' }, '/d')).toThrow()
    expect(() => parseBrowserSpec('firefox:/x')).toThrow(/chromium/)
  })
})

describe('浏览器代抓', () => {
  it('没配置时返回空串，只提示一次', async () => {
    const logs: string[] = []
    const fetcher = createNodeBrowserFetch({
      spec: null,
      dataDir: '/tmp',
      log: line => logs.push(line),
    })
    expect(await fetcher.browserFetch('https://a.example/')).toBe('')
    expect(await fetcher.browserFetch('https://b.example/')).toBe('')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/YINGBOX_BROWSER/)
  })

  it('等挑战过去拿到正文；硬封锁熔断后不再开页面', async () => {
    const { pw, launches } = fakePlaywright({
      'https://cf.example/list': [PAGE_CHALLENGE, PAGE_OK],
      'https://blocked.example/a': [PAGE_BLOCKED],
    })
    const fetcher = createNodeBrowserFetch({
      spec: { kind: 'chromium', path: '/usr/bin/chromium' },
      dataDir: '/tmp/yb',
      log: () => {},
      load: async () => pw,
      lookup,
    })
    expect(await fetcher.browserFetch('https://cf.example/list')).toBe(PAGE_OK)
    expect(launches[0]).toMatchObject({
      executablePath: '/usr/bin/chromium',
      headless: true,
    })
    expect(await fetcher.browserFetch('https://blocked.example/a')).toBe('')
    expect(await fetcher.browserFetch('https://blocked.example/b')).toBe('')
    fetcher.resetBrowserFetch('blocked.example')
    await fetcher.close()
    expect(launches).toHaveLength(1)
  })

  it('只许去公网：内网目标不开页面，页面里的内网请求（跳转、子资源）被中止', async () => {
    const { pw, launches } = fakePlaywright({
      'https://cf.example/list': [PAGE_OK],
    })
    const fetcher = createNodeBrowserFetch({
      spec: { kind: 'chromium', path: '/usr/bin/chromium' },
      dataDir: '/tmp/yb',
      log: () => {},
      load: async () => pw,
      lookup,
    })
    expect(await fetcher.browserFetch('http://192.168.1.1/')).toBe('')
    expect(await fetcher.browserFetch('http://router.lan/admin')).toBe('')
    expect(launches).toHaveLength(0)
    expect(await fetcher.browserFetch('https://cf.example/list')).toBe(PAGE_OK)
    await fetcher.close()

    const guard = publicOnlyRoute(lookup)
    const cases: Array<[string, string]> = [
      ['https://cdn.example/a.js', 'continue'],
      ['http://127.0.0.1:31480/api/info', 'abort:blockedbyclient'],
      ['http://nas.lan/', 'abort:blockedbyclient'],
      ['http://[::1]/', 'abort:blockedbyclient'],
      ['data:text/plain,hi', 'continue'],
    ]
    for (const [url, verdict] of cases) {
      const route = fakeRoute(url)
      await guard(route)
      expect(route.verdict, url).toBe(verdict)
    }
  })

  it('没装 playwright-core 时说明原因并返回空串', async () => {
    const logs: string[] = []
    const fetcher = createNodeBrowserFetch({
      spec: { kind: 'chromium', path: '/usr/bin/chromium' },
      dataDir: '/tmp/yb',
      log: line => logs.push(line),
      load: () =>
        Promise.reject(new Error("Cannot find module 'playwright-core'")),
      lookup,
    })
    expect(await fetcher.browserFetch('https://a.example/')).toBe('')
    expect(logs.join('\n')).toMatch(/没有安装 playwright-core/)
  })
})
