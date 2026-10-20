import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import { runCatSpider } from '../src/engine/online/catspider'
import { SITES, createOnlineHandlers, findM3u8 } from '../src/engine/online'
import {
  PLUGIN_TTL_MS,
  createPluginLoader,
} from '../src/engine/online/plugin-cache'
import type { EngineContext } from '../src/engine/rpc'

const lookup = async () => [{ address: '93.184.216.34' }]
/** 路由表式的假网络：url → 响应体（或返回 Response 的函数） */
const fakeNet = (routes: Record<string, string | (() => Response)>) =>
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
) => ({
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

describe('在线域 handlers', () => {
  const ctx = {
    host: vi.fn(async () => ''),
    emit: vi.fn(),
  } as unknown as EngineContext
  const handlers = (routes: Record<string, string | (() => Response)>) =>
    createOnlineHandlers({
      net: fakeNet(routes),
      loadPlugin: async () => PLUGIN,
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
