import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { type NetClient, createNetClient } from '../src/shared/net/client'
import { readFileSync } from 'node:fs'
import { runCatSpider } from '../src/engine/online/catspider'
import { createHostBreaker } from '../src/shared/net/host-breaker'
import { SITES, createOnlineHandlers, findM3u8 } from '../src/engine/online'
import {
  PLUGIN_TTL_MS,
  createPluginLoader,
} from '../src/engine/online/plugin-cache'
import { online } from '../src/shared/contract/online'
import type { EngineContext } from '../src/engine/rpc'

const lookup = async (): Promise<{ address: string }[]> => [
  { address: '93.184.216.34' },
]
/** 路由表式的假网络：url → 响应体（或返回 Response 的函数） */
const fakeNet = (
  routes: Record<string, string | (() => Response)>
): NetClient =>
  createNetClient({
    lookup,
    fetch: async url => {
      const route = routes[url]
      if (route === undefined) return new Response('nf', { status: 404 })
      return typeof route === 'function' ? route() : new Response(route)
    },
  })

const PLUGIN = `
async function search(ext) {
  const { text } = argsify(ext)
  const { data } = await $fetch.get('https://site.test/s?wd=' + text)
  const $ = createCheerio().load(data)
  return jsonify({ list: $('li').toArray().map(li => $(li).text()), wd: argsify(ext).wd })
}
async function getConfig() { return JSON.stringify({ ver: 'OLD_HOST' }) }
async function getTracks() { throw new Error('插件炸了') }
`

const deps = (
  net: ReturnType<typeof fakeNet>,
  browserFetch = vi.fn(async () => '')
): {
  net: typeof net
  browserFetch: typeof browserFetch
  loadPlugin: () => Promise<string>
} => ({
  net,
  browserFetch,
  loadPlugin: async () => PLUGIN,
})

describe('CatSpider 运行时', () => {
  it('插件经注入的 $fetch + cheerio 工作，搜索词别名补齐', async () => {
    const net = fakeNet({
      'https://site.test/s?wd=流浪': '<ul><li>A</li><li>B</li></ul>',
    })
    const result = await runCatSpider(deps(net), 'p.js', 'search', {
      text: '流浪',
    })
    expect(result).toEqual({ list: ['A', 'B'], wd: '流浪' })
  })

  it('直连拿到 Cloudflare 挑战页时改用主进程浏览器代抓', async () => {
    const net = fakeNet({
      'https://site.test/s?wd=x': '<title>Just a moment...</title>',
    })
    const browserFetch = vi.fn(async () => '<ul><li>真页面</li></ul>')
    const result = await runCatSpider(
      deps(net, browserFetch),
      'p.js',
      'search',
      { text: 'x' }
    )
    expect(browserFetch).toHaveBeenCalledWith('https://site.test/s?wd=x')
    expect(result).toMatchObject({ list: ['真页面'] })
  })

  it('站点 patch 在运行前替换源码；字符串结果被解析成对象', async () => {
    const result = await runCatSpider(
      deps(fakeNet({})),
      'p.js',
      'getConfig',
      {},
      { OLD_HOST: 'new.host' }
    )
    expect(result).toEqual({ ver: 'new.host' })
  })

  it('插件抛错或缺少入口不 reject，包成 success:false', async () => {
    await expect(
      runCatSpider(deps(fakeNet({})), 'p.js', 'getTracks', {})
    ).resolves.toEqual({ success: false, error: '插件炸了' })
    await expect(
      runCatSpider(deps(fakeNet({})), 'p.js', 'getCards', {})
    ).resolves.toMatchObject({ success: false })
  })
})

const BLOCKED = readFileSync(
  join(__dirname, 'fixtures/cloudflare/blocked-4k-av.html'),
  'utf-8'
)
const CHALLENGE = '<title>Just a moment...</title>'

/** 记录请求次数的假网络。 */
const countingNet = (
  routes: Record<string, () => Response>
): { net: NetClient; calls: string[] } => {
  const calls: string[] = []
  const net = createNetClient({
    lookup,
    fetch: async url => {
      calls.push(url)
      const route = routes[url]
      return route ? route() : new Response('nf', { status: 404 })
    },
  })
  return { net, calls }
}

describe('CatSpider 遇到硬封锁与熔断', () => {
  it('拿到硬封锁页：不找浏览器代抓，回报 blocked，插件得到 success:false', async () => {
    const { net } = countingNet({
      'https://site.test/s?wd=x': () => new Response(BLOCKED, { status: 403 }),
    })
    const browserFetch = vi.fn(async () => '<li>不该走到这里</li>')
    const onTrip = vi.fn()
    const result = await runCatSpider(
      { ...deps(net, browserFetch), onTrip },
      'p.js',
      'search',
      { text: 'x' }
    )
    expect(browserFetch).not.toHaveBeenCalled()
    expect(onTrip).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'site.test', reason: 'blocked' })
    )
    expect(result).toMatchObject({ success: false })
    expect(JSON.stringify(result)).toContain('被站点拦截')
  })

  it('同一熔断器下，被封的主机在冷却期内不再发请求', async () => {
    const { net, calls } = countingNet({
      'https://site.test/s?wd=x': () => new Response(BLOCKED, { status: 403 }),
    })
    const breaker = createHostBreaker()
    const onTrip = vi.fn()
    const run = (): Promise<unknown> =>
      runCatSpider({ ...deps(net), breaker, onTrip }, 'p.js', 'search', {
        text: 'x',
      })
    await run()
    await run()
    await run()
    expect(calls).toEqual(['https://site.test/s?wd=x'])
    expect(onTrip).toHaveBeenCalledTimes(3)
    breaker.reset('site.test')
    await run()
    expect(calls).toHaveLength(2)
  })

  it('挑战页代抓连续失败 3 次后熔断（challenge），之后不再请求也不再找浏览器', async () => {
    const { net, calls } = countingNet({
      'https://site.test/s?wd=x': () =>
        new Response(CHALLENGE, { status: 403 }),
    })
    const browserFetch = vi.fn(async () => '')
    const breaker = createHostBreaker()
    const onTrip = vi.fn()
    for (let i = 0; i < 5; i++)
      await runCatSpider(
        { ...deps(net, browserFetch), breaker, onTrip },
        'p.js',
        'search',
        { text: 'x' }
      )
    expect(browserFetch).toHaveBeenCalledTimes(3)
    expect(calls).toHaveLength(3)
    expect(onTrip.mock.calls[0][0]).toMatchObject({ reason: 'challenge' })
  })

  it('代抓拿回的仍是封锁页不当成功；成功一次清零失败计数', async () => {
    const { net } = countingNet({
      'https://site.test/s?wd=x': () =>
        new Response(CHALLENGE, { status: 403 }),
    })
    const breaker = createHostBreaker()
    const pages = [BLOCKED, BLOCKED, '<li>好了</li>', BLOCKED, BLOCKED, BLOCKED]
    const browserFetch = vi.fn(async () => pages.shift() ?? '')
    const run = (): Promise<unknown> =>
      runCatSpider({ ...deps(net, browserFetch), breaker }, 'p.js', 'search', {
        text: 'x',
      })
    const results: unknown[] = []
    for (let i = 0; i < 5; i++) results.push(await run())
    expect(results[2]).toMatchObject({ list: ['好了'] })
    expect(breaker.check('site.test')).toBeNull()
    await run()
    expect(breaker.check('site.test')).toMatchObject({ reason: 'challenge' })
  })

  it('POST 连不上记失败（不走浏览器），5xx 也记失败', async () => {
    const breaker = createHostBreaker({ threshold: 2 })
    const browserFetch = vi.fn(async () => '')
    const net = createNetClient({
      lookup,
      fetch: async () => {
        throw new Error('ECONNRESET')
      },
    })
    const post = `async function search() { await $fetch.post('https://p.test/api', { a: 1 }); return {} }`
    const run = (): Promise<unknown> =>
      runCatSpider(
        { net, browserFetch, breaker, loadPlugin: async () => post },
        'p.js',
        'search',
        {}
      )
    await run()
    await run()
    expect(browserFetch).not.toHaveBeenCalled()
    expect(breaker.check('p.test')).toMatchObject({ reason: 'unreachable' })

    const down = countingNet({
      'https://site.test/s?wd=x': () => new Response('down', { status: 522 }),
    })
    const b2 = createHostBreaker({ threshold: 2 })
    for (let i = 0; i < 2; i++)
      await runCatSpider({ ...deps(down.net), breaker: b2 }, 'p.js', 'search', {
        text: 'x',
      })
    expect(b2.check('site.test')).toMatchObject({ reason: 'unreachable' })
  })
})

describe('在线域 handlers', () => {
  const ctx = {
    host: vi.fn(async () => ''),
    emit: vi.fn(),
  } as unknown as EngineContext
  const handlers = (
    routes: Record<string, string | (() => Response)>
  ): ReturnType<typeof createOnlineHandlers> =>
    createOnlineHandlers({
      net: fakeNet(routes),
      loadPlugin: async () => PLUGIN,
    })

  it('后台检测标记须为布尔值，省略标记保持兼容', () => {
    const request = { action: 'search', siteName: SITES[0].name, keyword: 'x' }
    expect(
      online.calls.vod.parse([{ ...request, background: true }])[0].background
    ).toBe(true)
    expect(online.calls.vod.parse([request])[0].background).toBeUndefined()
    expect(() =>
      online.calls.vod.parse([{ ...request, background: 'yes' }])
    ).toThrow('background')
  })

  it('后台检测遇到验证页不调用浏览器，前台请求仍支持代抓', async () => {
    const h = handlers({
      'https://site.test/s?wd=x': '<title>Just a moment...</title>',
    })
    const host = vi.fn(async () => '<ul><li>正常页面</li></ul>')
    const context = { host, emit: vi.fn() } as unknown as EngineContext
    const result = await h.vod(context, {
      action: 'search',
      siteName: SITES[0].name,
      keyword: 'x',
      background: true,
    })
    expect(result.success).toBe(true)
    expect(host).not.toHaveBeenCalled()
    const foreground = await h.vod(context, {
      action: 'search',
      siteName: SITES[0].name,
      keyword: 'x',
    })
    expect(host).toHaveBeenCalledWith(
      'browserFetch',
      'https://site.test/s?wd=x'
    )
    expect(foreground.data).toMatchObject({ list: ['正常页面'] })
  })

  it('JSON 请求失败以结果返回，避免触发 IPC 未处理异常；成功数据保留原形状', async () => {
    const h = handlers({
      'https://site.test/ok': '{"list":[]}',
      'https://site.test/html': '<html>服务不可用</html>',
    })
    await expect(h.getJson(ctx, 'https://site.test/ok')).resolves.toEqual({
      success: true,
      data: { list: [] },
    })
    await expect(
      h.getJson(ctx, 'https://site.test/missing')
    ).resolves.toMatchObject({
      success: false,
      error: 'HTTP 404',
    })
    await expect(h.getJson(ctx, 'https://site.test/html')).resolves.toEqual({
      success: false,
      error: '接口返回的不是有效 JSON 数据',
    })
  })

  it('站点表只含 type 3，未知站点返回错误', async () => {
    expect(SITES.length).toBeGreaterThan(10)
    expect(SITES.every(s => s.type === 3)).toBe(true)
    await expect(
      handlers({}).vod(ctx, { action: 'search', siteName: '不存在' })
    ).resolves.toMatchObject({ success: false })
  })

  it('vod search 把 keyword 映射成插件的 text', async () => {
    const h = handlers({ 'https://site.test/s?wd=kw': '<li>R</li>' })
    const res = await h.vod(ctx, {
      action: 'search',
      siteName: SITES[0].name,
      keyword: 'kw',
    })
    expect(res).toEqual({ success: true, data: { list: ['R'], wd: 'kw' } })
  })

  it('vod 碰到硬封锁：回报 unavailable；resetBlocks 解除引擎熔断并通知主进程', async () => {
    const { net, calls } = countingNet({
      'https://site.test/s?wd=kw': () => new Response(BLOCKED, { status: 403 }),
    })
    const host = vi.fn(async () => '')
    const c = { host, emit: vi.fn() } as unknown as EngineContext
    const h = createOnlineHandlers({ net, loadPlugin: async () => PLUGIN })
    const req = { action: 'search', siteName: SITES[0].name, keyword: 'kw' }
    const first = await h.vod(c, req as never)
    expect(first).toMatchObject({
      success: true,
      unavailable: { host: 'site.test', reason: 'blocked' },
    })
    expect(JSON.stringify(first.data)).toContain('被站点拦截')
    await h.vod(c, req as never)
    expect(calls).toHaveLength(1)
    expect(host).not.toHaveBeenCalledWith('browserFetch', expect.anything())
    await h.resetBlocks(c, 'site.test')
    expect(host).toHaveBeenCalledWith('resetBrowserFetch', 'site.test')
    await h.vod(c, req as never)
    expect(calls).toHaveLength(2)
  })

  it('插件脚本下载失败：回报 plugin，5 分钟内不再下载；resetBlocks 后重试', async () => {
    const loadPlugin = vi.fn(async () => {
      throw new Error('ETIMEDOUT')
    })
    const h = createOnlineHandlers({ net: fakeNet({}), loadPlugin })
    const req = { action: 'search', siteName: SITES[0].name, keyword: 'kw' }
    const res = await h.vod(ctx, req as never)
    expect(res).toMatchObject({
      success: false,
      unavailable: { reason: 'plugin', host: 'ghp.xptvhelper.link' },
    })
    expect(res.error).toContain('插件脚本下载失败')
    await h.vod(ctx, req as never)
    expect(loadPlugin).toHaveBeenCalledTimes(1)
    await h.resetBlocks(ctx, undefined)
    await h.vod(ctx, req as never)
    expect(loadPlugin).toHaveBeenCalledTimes(2)
  })

  it('resolvePage：跳转到媒体直链取最终地址；否则从 HTML 提取 m3u8；失败原样返回', async () => {
    const h = handlers({
      'https://p.test/jump': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.test/v.mp4' },
        }),
      'https://cdn.test/v.mp4': 'binary',
      'https://p.test/page':
        '<script>var u="https://cdn.test/a/index.m3u8?t=1"</script>',
    })
    await expect(h.resolvePage(ctx, 'https://p.test/jump')).resolves.toBe(
      'https://cdn.test/v.mp4'
    )
    await expect(h.resolvePage(ctx, 'https://p.test/page')).resolves.toBe(
      'https://cdn.test/a/index.m3u8?t=1'
    )
    await expect(h.resolvePage(ctx, 'https://p.test/404')).resolves.toBe(
      'https://p.test/404'
    )
    expect(findM3u8('nothing')).toBeUndefined()
  })
})

describe('插件源码缓存', () => {
  it('未过期读盘；过期重新拉取；拉取失败回退旧缓存', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-cache-'))
    let body: string | null = 'v1'
    const net = createNetClient({
      lookup,
      fetch: async () =>
        body === null ? new Response('x', { status: 500 }) : new Response(body),
    })
    let clock = Date.now()
    const load = createPluginLoader(net, dir, () => clock)
    expect(await load('https://p.test/a.js')).toBe('v1')
    body = 'v2'
    expect(await load('https://p.test/a.js')).toBe('v1')
    clock += PLUGIN_TTL_MS + 1000
    expect(await load('https://p.test/a.js')).toBe('v2')
    body = null
    clock += PLUGIN_TTL_MS + 1000
    expect(await load('https://p.test/a.js')).toBe('v2')
  })
})
