/**
 * 磁力来源：链接解析与合并、种子 infohash、Torznab（地址、参数、XML、错误、退回 t=search、
 * 种子地址解析与同主机限制、多接口部分失败、测试连接）、界面搜索合并 PanSou 与 Torznab。
 * 全部用假 fetch 与构造的响应，不访问外网。
 */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  magnetOf,
  mergeMagnets,
  normalizeInfoHash,
  parseOfflineLink,
} from '../../src/main/pan115/magnet-link'
import { createSourceSearch } from '../../src/main/pan115/sources'
import { parseTorrent } from '../../src/main/pan115/torrent'
import {
  RESOLVE_MAX,
  searchTorznab,
  testTorznab,
  torznabEndpoint,
  torznabSearchUrl,
} from '../../src/main/pan115/torznab'
import { parseTorznab, xmlText } from '../../src/main/pan115/torznab-xml'
import {
  parseTorznabSecret,
  serializeTorznabSecret,
  torznabFromEnv,
} from '../../src/main/pan115/torznab-secret'
import type { MagnetItem } from '../../src/shared/contract/pan115'
import { fakeFetch } from './fixtures'
import {
  CAPS,
  ERROR_KEY,
  ERROR_NO_FUNCTION,
  HASH_A,
  HASH_B,
  JACKETT_RSS,
  PROWLARR_RSS,
  TINY_INFO,
  tinyTorrent,
} from './torznab-fixtures'

const xml = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/xml' } })
const JACKETT = 'http://nas:9117/api/v2.0/indexers/all/results/torznab/api'

describe('磁力链接', () => {
  it('btih 十六进制 / base32 归一，ed2k 取哈希与大小', () => {
    expect(normalizeInfoHash(HASH_A.toUpperCase())).toBe(HASH_A)
    // base32 "AAAA…"（32 个 A）= 20 个零字节
    expect(normalizeInfoHash('A'.repeat(32))).toBe('0'.repeat(40))
    expect(normalizeInfoHash('xyz')).toBe('')
    expect(
      parseOfflineLink(`magnet:?dn=a+b&xt=urn:btih:${HASH_A}&xl=9`)
    ).toEqual({ kind: 'magnet', hash: HASH_A, name: 'a b', size: 9 })
    expect(
      parseOfflineLink(
        'ed2k://|file|x.mkv|10|0123456789ABCDEF0123456789ABCDEF|/'
      )
    ).toMatchObject({ kind: 'ed2k', size: 10 })
    expect(parseOfflineLink('magnet:?xt=urn:sha1:abc')).toBeNull()
    expect(magnetOf(HASH_A, '名 字', ['udp://t:1'])).toBe(
      `magnet:?xt=urn:btih:${HASH_A}&dn=%E5%90%8D%20%E5%AD%97&tr=udp%3A%2F%2Ft%3A1`
    )
  })

  it('合并：同哈希 Torznab 优先、字段互补；做种数降序、大小次之；有上限', () => {
    const base = { kind: 'magnet', link: 'magnet:?', source: '' } as const
    const items: MagnetItem[][] = [
      [
        {
          ...base,
          title: 'p',
          origin: 'pansou',
          hash: 'h1',
          size: 5,
          datetime: 'd',
        },
        { ...base, title: 'big', origin: 'pansou', hash: 'h2', size: 9 },
      ],
      [
        { ...base, title: 't', origin: 'torznab', hash: 'h1', seeders: 3 },
        { ...base, title: 'hot', origin: 'torznab', hash: 'h3', seeders: 50 },
      ],
    ]
    const merged = mergeMagnets(items)
    expect(merged.map(m => m.title)).toEqual(['hot', 't', 'big'])
    expect(merged[1]).toMatchObject({ size: 5, datetime: 'd', seeders: 3 })
    expect(mergeMagnets(items, 2)).toHaveLength(2)
  })
})

describe('种子 → infohash', () => {
  it('取 info 原文 SHA-1、名字与 tracker；坏数据返回 null', () => {
    const info = parseTorrent(tinyTorrent())
    expect(info).toEqual({
      hash: createHash('sha1').update(TINY_INFO).digest('hex'),
      name: 'demo.mkv',
      trackers: ['udp://tracker.example.org:1337'],
    })
    expect(parseTorrent(new TextEncoder().encode('d4:infoi1ee'))).toBeNull()
    expect(parseTorrent(new TextEncoder().encode('<html>'))).toBeNull()
    expect(parseTorrent(new TextEncoder().encode('d4:info'))).toBeNull()
  })
})

describe('Torznab 地址与参数', () => {
  it('只填主机补 /api；路径原样；去掉地址里的 apikey；只接受 http(s)', () => {
    expect(torznabEndpoint('http://nas:9696')).toBe('http://nas:9696/api')
    expect(torznabEndpoint(' http://nas:9696/1/api?apikey=x ')).toBe(
      'http://nas:9696/1/api'
    )
    expect(torznabEndpoint(JACKETT)).toBe(JACKETT)
    expect(() => torznabEndpoint('nas:9696')).toThrow('http')
  })

  it('有 imdb / tmdb 时用 movie / tvsearch（imdb 去 tt），否则 t=search', () => {
    const movie = new URL(
      torznabSearchUrl('http://nas/api', 'K', {
        q: '示例',
        kind: 'movie',
        imdbId: 'tt0111161',
        tmdbId: 278,
      })
    ).searchParams
    expect(Object.fromEntries(movie)).toMatchObject({
      t: 'movie',
      apikey: 'K',
      q: '示例',
      imdbid: '0111161',
      tmdbid: '278',
    })
    const tv = new URL(
      torznabSearchUrl('http://nas/api', 'K', {
        q: 'x',
        kind: 'tv',
        tmdbId: 1,
        season: 2,
        episode: 3,
      })
    ).searchParams
    expect([tv.get('t'), tv.get('season'), tv.get('ep')]).toEqual([
      'tvsearch',
      '2',
      '3',
    ])
    const plain = new URL(
      torznabSearchUrl('http://nas/api', '', { q: 'x', kind: 'movie' })
    ).searchParams
    expect([plain.get('t'), plain.has('apikey')]).toEqual(['search', false])
  })
})

describe('Torznab XML', () => {
  it('Jackett：magneturl / infohash / 只有下载地址；索引器名、大小、做种、下载人数、时间', () => {
    const entries = parseTorznab(JACKETT_RSS, 'nas')
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({
      indexer: 'Tracker One',
      size: 16106127360,
      seeders: 120,
      peers: 30,
      datetime: '2026-10-20T12:00:00.000Z',
      link: `magnet:?xt=urn:btih:${HASH_A}&dn=Example.Movie`,
    })
    expect(entries[1]).toMatchObject({
      title: '示例电影 2024 1080p 中字',
      size: 4294967296,
      link: expect.stringContaining(HASH_B),
    })
    expect(entries[2]).toMatchObject({
      link: undefined,
      download: 'http://nas:9117/dl/tracker3/?jackett_apikey=KEY&path=ghi',
    })
    expect(parseTorznab(PROWLARR_RSS, 'nas')[0].indexer).toBe('Public Tracker')
  })

  it('错误响应抛人话并带错误码；不是 RSS 时报错；实体反转义', () => {
    expect(() => parseTorznab(ERROR_KEY, 'x')).toThrow('API Key 不对')
    expect(() => parseTorznab('<html>hi</html>', 'x')).toThrow('不是 RSS')
    expect(xmlText('a &amp; b &#x4E2D;&#25991;')).toBe('a & b 中文')
  })
})

describe('searchTorznab', () => {
  it('解析出磁力、只解析同主机的种子地址（302 到 magnet），做种数排序，Key 只在请求里', async () => {
    const { fetch, sent } = fakeFetch({
      [JACKETT]: xml(JACKETT_RSS),
      'http://nas:9117/dl/tracker3/': new Response(null, {
        status: 302,
        headers: { location: `magnet:?xt=urn:btih:${'c'.repeat(40)}` },
      }),
    })
    const { magnets, notes } = await searchTorznab(fetch, [JACKETT], 'KEY', {
      q: '示例',
    })
    expect(notes).toEqual([])
    expect(magnets.map(m => [m.hash, m.seeders])).toEqual([
      [HASH_A, 120],
      [HASH_B, 8],
      ['c'.repeat(40), 3],
    ])
    expect(magnets.every(m => m.origin === 'torznab')).toBe(true)
    expect(sent.some(r => r.url.startsWith('http://other-host'))).toBe(false)
    expect(new URL(sent[0].url).searchParams.get('apikey')).toBe('KEY')
  })

  it('种子地址返回种子文件时算 infohash；最多解析 RESOLVE_MAX 条', async () => {
    const items = Array.from(
      { length: RESOLVE_MAX + 3 },
      (_, i) =>
        `<item><title>R${i}</title><link>http://nas/dl/${i}</link><torznab:attr name="seeders" value="${i}"/></item>`
    ).join('')
    const { fetch, sent } = fakeFetch({
      'http://nas/api': xml(`<rss><channel>${items}</channel></rss>`),
      'http://nas/dl/': () => new Response(Buffer.from(tinyTorrent())),
    })
    const { magnets } = await searchTorznab(fetch, ['http://nas'], '', {
      q: 'x',
    })
    // 同一个种子 → 同一个哈希，合并成一条
    expect(magnets).toHaveLength(1)
    expect(magnets[0].link).toContain('tr=udp')
    expect(sent.filter(r => r.url.includes('/dl/'))).toHaveLength(RESOLVE_MAX)
  })

  it('movie 搜索不支持（203）时退回 t=search', async () => {
    const { fetch, sent } = fakeFetch({
      'http://nas/api': (req: { url: string }) =>
        new URL(req.url).searchParams.get('t') === 'movie'
          ? xml(ERROR_NO_FUNCTION)
          : xml(PROWLARR_RSS),
    })
    const { magnets } = await searchTorznab(fetch, ['http://nas/api'], 'K', {
      q: 'x',
      kind: 'movie',
      imdbId: 'tt1',
    })
    expect(magnets).toHaveLength(1)
    expect(sent.map(r => new URL(r.url).searchParams.get('t'))).toEqual([
      'movie',
      'search',
    ])
  })

  it('多个接口：一个失败只记说明；全部失败抛错（401 时读错误 XML）', async () => {
    const { fetch } = fakeFetch({
      'http://a/api': xml(PROWLARR_RSS),
      'http://b/api': () => xml(ERROR_KEY, 401),
    })
    const result = await searchTorznab(fetch, ['http://a', 'http://b'], 'K', {
      q: 'x',
    })
    expect(result.magnets).toHaveLength(1)
    expect(result.notes).toEqual(['Torznab（b）：API Key 不对'])
    await expect(
      searchTorznab(fetch, ['http://b'], 'K', { q: 'x' })
    ).rejects.toThrow('API Key 不对')
  })

  it('接口重定向到别的主机被拦截', async () => {
    const { fetch, sent } = fakeFetch({
      'http://nas/api': new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      }),
    })
    await expect(
      searchTorznab(fetch, ['http://nas'], '', { q: 'x' })
    ).rejects.toThrow('别的主机')
    expect(sent).toHaveLength(1)
  })
})

describe('testTorznab', () => {
  it('每个地址一行：能力说明或失败原因', async () => {
    const { fetch, sent } = fakeFetch({
      'http://a/api': xml(CAPS),
      'http://b/api': xml(ERROR_KEY, 401),
    })
    const result = await testTorznab(fetch, ['http://a', 'http://b'], 'K')
    expect(result.ok).toBe(false)
    expect(result.lines).toEqual([
      'a：Jackett · 支持电影 / 剧集搜索',
      'http://b：API Key 不对',
    ])
    expect(new URL(sent[0].url).searchParams.get('t')).toBe('caps')
  })
})

describe('Torznab 配置存储', () => {
  it('序列化往返；坏 JSON 为 null；服务端环境变量兜底', () => {
    const value = { urls: ['http://a', 'http://a', ' http://b '], apiKey: 'k' }
    expect(parseTorznabSecret(serializeTorznabSecret(value))).toEqual({
      urls: ['http://a', 'http://b'],
      apiKey: 'k',
    })
    expect(parseTorznabSecret('{x')).toBeNull()
    expect(serializeTorznabSecret(null)).toBe('')
    expect(
      torznabFromEnv({
        YINGBOX_TORZNAB_URL: 'http://a, http://b',
        YINGBOX_TORZNAB_API_KEY: ' k ',
      })
    ).toEqual({ urls: ['http://a', 'http://b'], apiKey: 'k' })
    expect(torznabFromEnv({})).toBeNull()
  })
})

describe('界面搜索：PanSou + Torznab', () => {
  const pansouBody = {
    merged_by_type: {
      '115': [{ url: 'https://115.com/s/sw1', password: '', note: '分享' }],
      magnet: [
        { url: `magnet:?xt=urn:btih:${HASH_A}`, note: '来自 PanSou' },
        { url: `magnet:?xt=urn:btih:${'d'.repeat(40)}`, note: '只有 PanSou' },
      ],
    },
  }

  function setup(
    routes: Parameters<typeof fakeFetch>[0],
    pansou = 'http://pansou',
    torznab: string[] = ['http://nas']
  ): ReturnType<typeof createSourceSearch> {
    let saved = torznab.length ? { urls: torznab, apiKey: 'K' } : null
    return createSourceSearch({
      lanFetch: fakeFetch(routes).fetch,
      settings: { pansouUrl: () => pansou },
      torznab: {
        read: () => saved,
        write: async value => {
          saved = value
        },
      },
    })
  }

  it('两边都出结果：磁力按哈希合并（Torznab 的带做种数在前）', async () => {
    const sources = setup({
      'http://pansou/api/search': pansouBody,
      'http://nas/api': xml(PROWLARR_RSS),
    })
    const result = await sources.search('示例')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(1)
    expect(result.magnets.map(m => [m.origin, m.hash])).toEqual([
      ['torznab', HASH_A],
      ['pansou', 'd'.repeat(40)],
    ])
    expect(result.notes).toEqual([])
  })

  it('一边失败只记说明；两边都失败整体失败；都没填提示去设置', async () => {
    const half = setup({
      'http://pansou/api/search': new Response('x', { status: 502 }),
      'http://nas/api': xml(PROWLARR_RSS),
    })
    const result = await half.search('示例')
    expect(result.ok && result.notes).toEqual(['PanSou 返回 HTTP 502'])
    const both = setup({
      'http://pansou/api/search': new Response('x', { status: 502 }),
      'http://nas/api': xml(ERROR_KEY, 401),
    })
    expect(await both.search('示例')).toEqual({
      ok: false,
      error: 'PanSou 返回 HTTP 502；Torznab（nas）：API Key 不对',
    })
    expect(await setup({}, '', []).search('x')).toEqual({
      ok: false,
      error: '请先在设置 · 网盘里填写 PanSou 或 Torznab 地址',
    })
  })

  it('只填 Torznab 也能搜；配置读写：Key 不回给渲染层，null 保留原 Key，空串清除', async () => {
    const sources = setup({ 'http://nas/api': xml(PROWLARR_RSS) }, '')
    const result = await sources.search('x')
    expect(result.ok && result.magnets).toHaveLength(1)
    expect(await sources.torznab()).toEqual({
      urls: ['http://nas'],
      hasKey: true,
    })
    await sources.setTorznab(['http://x', ''], null)
    expect(await sources.torznab()).toEqual({
      urls: ['http://x'],
      hasKey: true,
    })
    await sources.setTorznab(['http://x'], '')
    expect(await sources.torznab()).toEqual({
      urls: ['http://x'],
      hasKey: false,
    })
    await sources.setTorznab([], '')
    expect(await sources.torznab()).toEqual({ urls: [], hasKey: false })
  })
})
