/**
 * 熔断粒度与持久化：在线插件源按「主机 + 路径类别」熔断（搜索被封不连带分类），
 * 引擎熔断落盘、重启后恢复未过期的；渲染层按「源 + 类别」记录与清除。
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type HostTrip,
  createHostBreaker,
  pathScope,
} from '../src/shared/net/host-breaker'
import {
  createPersistentBreaker,
  readTrips,
} from '../src/engine/online/breaker-store'
import { createNetClient } from '../src/shared/net/client'
import { runCatSpider } from '../src/engine/online/catspider'
import {
  markPluginOk,
  markPluginUnavailable,
  pluginHealthOf,
  pluginRowProps,
  pluginSearchHealthOf,
  retryPlugin,
} from '../src/renderer/src/features/online/composables/plugin-health'
import { useVODParser } from '../src/renderer/src/features/online/composables/use-vod-parser'

const BLOCKED =
  '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>'

describe('pathScope：按插件真实地址分搜索 / 其余', () => {
  it.each([
    'https://4kmp.com/s?q=SSIS',
    'https://www.novipnoad.net/page/1/?s=繁花',
    'https://www.zxzjhd.com/vodsearch/-------------.html?wd=x&submit=',
    'https://www.lmm85.com/vod/search.html',
    'https://rankv21.iyf.tv/v3/list/briefsearch?tags=x',
    'https://vip.wwgz.cn:5200/index.php?m=vod-search',
    'https://saohuody.com/s----------.html?wd=x',
    'https://hanime1.me/search?query=x&page=1',
    'https://www.kuaikaw.cn/search?searchValue=x',
  ])('search：%s', url => expect(pathScope(url)).toBe('search'))

  it.each([
    'https://4kmp.com/movie/',
    'https://www.zxzjhd.com/vodshow/1--------1---.html',
    'https://jable.tv/categories/',
    'https://www.kuaikaw.cn/seo/video/6007',
    'https://example.com/shop/sale',
    'https://example.com/play?id=1&sid=2',
    '4kmp.com',
  ])('browse：%s', url => expect(pathScope(url)).toBe('browse'))
})

describe('分类别熔断', () => {
  const scoped = (): ReturnType<typeof createHostBreaker> =>
    createHostBreaker({ scopeOf: pathScope, now: () => 0 })

  it('搜索被封不连带同主机的分类；熔断信息带类别', () => {
    const b = scoped()
    expect(b.block('https://4kmp.com/s?q=x')).toEqual({
      host: '4kmp.com',
      reason: 'blocked',
      until: 30 * 60_000,
      scope: 'search',
    })
    expect(b.check('https://4kmp.com/s?q=other')).toMatchObject({
      scope: 'search',
    })
    expect(b.check('https://4kmp.com/movie/')).toBeNull()
  })

  it('连续失败按类别分开计数；reset(主机) 清掉该主机所有类别', () => {
    const b = scoped()
    b.fail('https://a.test/search?q=1')
    b.fail('https://a.test/search?q=2')
    b.fail('https://a.test/list/1')
    expect(b.fail('https://a.test/list/2')).toBeNull()
    expect(b.fail('https://a.test/search?q=3')).toMatchObject({
      scope: 'search',
    })
    b.block('https://a.test/list/3')
    b.block('https://b.test/search?q=1')
    b.reset('a.test')
    expect(b.check('https://a.test/search?q=1')).toBeNull()
    expect(b.check('https://a.test/list/1')).toBeNull()
    expect(b.check('https://b.test/search?q=1')).not.toBeNull()
  })

  it('不传 scopeOf 时仍按整个主机熔断（番号刮削用），熔断信息不带类别', () => {
    const b = createHostBreaker({ now: () => 0 })
    expect(b.block('https://a.test/search?q=1')).not.toHaveProperty('scope')
    expect(b.check('https://a.test/list/1')).not.toBeNull()
  })

  it('restore 丢掉已过期的；熔断、到期清理、解除时 onChange 拿到当前熔断表', () => {
    let t = 100
    const onChange = vi.fn()
    const b = createHostBreaker({
      scopeOf: pathScope,
      cooldownMs: 50,
      now: () => t,
      restore: [
        { host: 'old.test', reason: 'blocked', until: 100 },
        { host: 'live.test', reason: 'challenge', until: 120, scope: 'search' },
      ],
      onChange,
    })
    expect(b.check('https://live.test/search?q=1')).toMatchObject({
      reason: 'challenge',
    })
    expect(b.check('https://live.test/x')).toBeNull()
    b.block('https://c.test/x')
    expect(onChange).toHaveBeenLastCalledWith([
      { host: 'live.test', reason: 'challenge', until: 120, scope: 'search' },
      { host: 'c.test', reason: 'blocked', until: 150, scope: 'browse' },
    ])
    expect(b.check('https://old.test/x')).toBeNull()
    t = 130
    expect(b.check('https://live.test/search?q=1')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith([
      { host: 'c.test', reason: 'blocked', until: 150, scope: 'browse' },
    ])
    b.reset()
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})

describe('引擎熔断落盘', () => {
  it('熔断写进文件；新实例（重启）从文件恢复未过期的', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brk-'))
    const file = join(dir, 'online', 'breaker.json')
    const first = createPersistentBreaker(file)
    first.block('https://4kmp.com/s?q=x')
    expect(readTrips(file)).toEqual([
      expect.objectContaining({
        host: '4kmp.com',
        reason: 'blocked',
        scope: 'search',
      }),
    ])
    const second = createPersistentBreaker(file)
    expect(second.check('https://4kmp.com/s?q=y')).toMatchObject({
      reason: 'blocked',
    })
    expect(second.check('https://4kmp.com/movie/')).toBeNull()
    second.reset('4kmp.com')
    expect(readTrips(file)).toEqual([])
    expect(
      createPersistentBreaker(file).check('https://4kmp.com/s?q=y')
    ).toBeNull()
  })

  it('过期的不恢复；不带类别的旧记录对整站生效；文件损坏或条目形状不对时忽略', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brk-'))
    const file = join(dir, 'breaker.json')
    const later = Date.now() + 60_000
    await writeFile(
      file,
      JSON.stringify([
        { host: 'gone.test', reason: 'blocked', until: 1 },
        { host: 'bad.test', reason: 'nope', until: later },
        { host: 'bad2.test', reason: 'blocked', until: later, scope: 'x' },
        { host: 'ok.test', reason: 'unreachable', until: later },
      ])
    )
    expect(readTrips(file).map(t => t.host)).toEqual(['gone.test', 'ok.test'])
    const b = createPersistentBreaker(file)
    expect(b.check('https://gone.test/x')).toBeNull()
    expect(b.check('https://ok.test/search?q=1')).toMatchObject({
      reason: 'unreachable',
    })
    expect(b.check('https://ok.test/list')).toMatchObject({
      reason: 'unreachable',
    })
    await writeFile(file, '{not json')
    expect(readTrips(file)).toEqual([])
    expect(readTrips(join(dir, 'missing.json'))).toEqual([])
  })
})

describe('CatSpider：4k-av 搜索被封，分类照常', () => {
  it('同一熔断器下搜索回报 search 熔断，之后分类仍发请求并拿到结果', async () => {
    const hits: string[] = []
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async url => {
        hits.push(url)
        if (url.includes('/s?q=')) return new Response(BLOCKED, { status: 403 })
        return new Response('<ul><li>片A</li></ul>')
      },
    })
    const plugin = `
      async function search(ext) { const { data } = await $fetch.get('https://4kmp.com/s?q=' + argsify(ext).text); return { list: [data] } }
      async function getCards() { const { data } = await $fetch.get('https://4kmp.com/movie/'); const $ = createCheerio().load(data); return { list: $('li').toArray().map(li => $(li).text()) } }`
    const breaker = createHostBreaker({ scopeOf: pathScope })
    const onTrip = vi.fn()
    const deps = {
      net,
      browserFetch: vi.fn(async () => ''),
      loadPlugin: async () => plugin,
      breaker,
      onTrip,
    }
    expect(
      await runCatSpider(deps, 'p.js', 'search', { text: 'x' })
    ).toMatchObject({ success: false })
    expect(onTrip).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'blocked', scope: 'search' })
    )
    await runCatSpider(deps, 'p.js', 'search', { text: 'y' })
    expect(hits.filter(u => u.includes('/s?q='))).toHaveLength(1)
    expect(await runCatSpider(deps, 'p.js', 'getCards', {})).toEqual({
      list: ['片A'],
    })
    expect(deps.browserFetch).not.toHaveBeenCalled()
  })
})

describe('渲染层按源 + 类别记录', () => {
  const trip = (scope?: 'search' | 'browse', host = '4kmp.com'): HostTrip => ({
    host,
    reason: 'blocked',
    until: Date.now() + 30 * 60_000,
    ...(scope ? { scope } : {}),
  })
  const online = {
    resetBlocks: vi.fn(async () => {}),
    vod: vi.fn(async (): Promise<unknown> => ({ success: true, data: {} })),
  }
  beforeEach(() => {
    vi.useFakeTimers()
    online.resetBlocks.mockClear()
    ;(globalThis as { window?: unknown }).window = {
      api: { online },
      setTimeout,
      clearTimeout,
    }
  })
  afterEach(() => {
    markPluginOk('4k-av')
    vi.useRealTimers()
    delete (globalThis as { window?: unknown }).window
  })

  it('只有搜索被封：搜索跳过，列表标红并写「搜索被站点拦截」', () => {
    markPluginUnavailable('4k-av', trip('search'))
    expect(pluginSearchHealthOf('4k-av')).toMatchObject({ scope: 'search' })
    expect(pluginRowProps('4k-av')).toMatchObject({
      status: 'fail',
      note: '搜索被站点拦截 · 约 30 分钟后自动重试',
    })
  })

  it('只有分类被封：搜索不跳过，列表写「分类与播放被站点拦截」；整站熔断挡搜索', () => {
    markPluginUnavailable('4k-av', trip('browse'))
    expect(pluginSearchHealthOf('4k-av')).toBeUndefined()
    expect(pluginRowProps('4k-av').note).toBe(
      '分类与播放被站点拦截 · 约 30 分钟后自动重试'
    )
    markPluginOk('4k-av')
    markPluginUnavailable('4k-av', trip())
    expect(pluginSearchHealthOf('4k-av')).toMatchObject({ reason: 'blocked' })
    expect(pluginRowProps('4k-av').note).toBe(
      '被站点拦截 · 约 30 分钟后自动重试'
    )
  })

  it('分类成功不清搜索记录；搜索成功才清；任一成功都清整站记录', async () => {
    const parser = useVODParser()
    markPluginUnavailable('4k-av', trip('search'))
    await parser.getCards({ siteName: '4k-av' } as never)
    expect(pluginSearchHealthOf('4k-av')).toBeDefined()
    await parser.search({ siteName: '4k-av', keyword: 'x' })
    expect(pluginHealthOf('4k-av')).toBeUndefined()
    markPluginUnavailable('4k-av', trip('browse'))
    await parser.search({ siteName: '4k-av', keyword: 'x' })
    expect(pluginHealthOf('4k-av')).toMatchObject({ scope: 'browse' })
    markPluginUnavailable('4k-av', trip())
    await parser.getCards({ siteName: '4k-av' } as never)
    expect(pluginHealthOf('4k-av')).toBeUndefined()
  })

  it('两类各自到期；重试时对每个涉及的主机解除一次', async () => {
    markPluginUnavailable('4k-av', {
      ...trip('search'),
      until: Date.now() + 60_000,
    })
    markPluginUnavailable('4k-av', trip('browse', '4k-av.com'))
    vi.advanceTimersByTime(60_000)
    expect(pluginSearchHealthOf('4k-av')).toBeUndefined()
    expect(pluginHealthOf('4k-av')).toMatchObject({ scope: 'browse' })
    markPluginUnavailable('4k-av', trip('search'))
    await retryPlugin('4k-av')
    expect(pluginHealthOf('4k-av')).toBeUndefined()
    expect(online.resetBlocks.mock.calls).toEqual([['4k-av.com'], ['4kmp.com']])
  })
})
