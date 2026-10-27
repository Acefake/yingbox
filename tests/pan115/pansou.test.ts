/**
 * PanSou 搜索与公共请求：响应解析、上限与去重、只跟同主机重定向、超时识别、错误码人话。
 * 全部用假 fetch，不访问外网。
 */
import { describe, expect, it, vi } from 'vitest'

import { Pan115Error, errnoMessage } from '../../src/main/pan115/errors'
import { fetchJson } from '../../src/main/pan115/http'
import {
  MAX_RESULTS,
  PANSOU_ATTEMPTS,
  panSouEndpoint,
  parsePanSouResponse,
  searchPanSou,
} from '../../src/main/pan115/pansou'
import { PANSOU_PUBLIC_URL } from '../../src/shared/contract/pan115'
import { defaultValues } from '../../src/shared/settings/schema'
import { PANSOU_BARE, PANSOU_WRAPPED, fakeFetch } from './fixtures'

const entry = (i: number, extra: Record<string, unknown> = {}): unknown => ({
  url: `https://115.com/s/sw${i}`,
  password: '',
  note: `条目${i}`,
  source: 'tg:x',
  ...extra,
})
const wrap = (list: unknown[]): unknown => ({
  code: 0,
  data: { merged_by_type: { '115': list } },
})

describe('parsePanSouResponse', () => {
  it('解析带 data 外壳的响应：只留可解析的 115 链接，零值时间丢掉', () => {
    const first = PANSOU_WRAPPED.data.merged_by_type['115'][0]
    expect(parsePanSouResponse(PANSOU_WRAPPED).shares).toEqual([
      {
        title: '示例纪录片 4K',
        source: 'tg:Channel_Shares_115',
        datetime: first.datetime,
        url: 'https://115cdn.com/s/swh3abc12?password=x1y2#',
        shareCode: 'swh3abc12',
        receiveCode: 'x1y2',
      },
      {
        title: '示例剧集 全季',
        source: 'plugin:hdr4k',
        datetime: undefined,
        url: 'https://115.com/s/swzz9988',
        shareCode: 'swzz9988',
        receiveCode: 'k9k9',
      },
    ])
  })

  it('解析 README 的裸格式；提取码在链接里时补上', () => {
    const [item] = parsePanSouResponse(PANSOU_BARE).shares
    expect(item.receiveCode).toBe('abcd')
    expect(item.title).toBe('裸格式条目')
  })

  it('没有 115 结果时为空数组；code 非 0 时抛出服务给的信息', () => {
    expect(parsePanSouResponse({ code: 0, data: { total: 0 } })).toEqual({
      shares: [],
      magnets: [],
    })
    expect(() =>
      parsePanSouResponse({ code: 400, message: '关键词不能为空' })
    ).toThrow('关键词不能为空')
    expect(() => parsePanSouResponse('oops')).toThrow(Pan115Error)
  })

  it('大响应截断到上限，标题与来源限制长度', () => {
    const list = Array.from({ length: 5000 }, (_, i) =>
      entry(
        i,
        i === 0 ? { note: '长'.repeat(5000), source: 's'.repeat(999) } : {}
      )
    )
    const items = parsePanSouResponse(wrap(list)).shares
    expect(items).toHaveLength(MAX_RESULTS)
    expect(items[0].title.length).toBeLessThanOrEqual(200)
    expect(items[0].source.length).toBeLessThanOrEqual(80)
  })

  it('同一分享（分享码 + 提取码相同）只留第一条', () => {
    const items = parsePanSouResponse(
      wrap([
        entry(1),
        entry(1, { note: '重复' }),
        { ...(entry(1) as object), url: 'https://115cdn.com/s/sw1' },
        entry(1, { password: 'ab12' }),
        entry(2),
      ])
    ).shares
    expect(items.map(i => `${i.shareCode}/${i.receiveCode}`)).toEqual([
      'sw1/',
      'sw1/ab12',
      'sw2/',
    ])
  })
})

describe('磁力 / 电驴', () => {
  const HEX = '0123456789abcdef0123456789abcdef01234567'
  const magnetEntry = (
    url: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    url,
    password: '',
    note: '',
    source: 'plugin:x',
    datetime: '0001-01-01T00:00:00Z',
    ...extra,
  })

  it('解析 magnet / ed2k：哈希归一（base32 → hex）、按哈希去重、标题缺省用 dn', () => {
    const result = parsePanSouResponse({
      merged_by_type: {
        magnet: [
          magnetEntry(
            `magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Show.S01.2160p&xl=1024`
          ),
          magnetEntry(`magnet:?xt=urn:btih:${HEX}`, { note: '重复' }),
          magnetEntry('magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVSYZK4JVPG66AJD', {
            note: 'base32',
          }),
          magnetEntry('magnet:?dn=没有哈希'),
          magnetEntry('https://example.com/not-magnet'),
        ],
        ed2k: [
          magnetEntry(
            'ed2k://|file|%E7%A4%BA%E4%BE%8B.mkv|734003200|0123456789ABCDEF0123456789ABCDEF|/'
          ),
        ],
      },
    })
    expect(result.shares).toEqual([])
    expect(result.magnets.find(m => m.hash === HEX)).toMatchObject({
      kind: 'magnet',
      title: 'Show.S01.2160p',
      size: 1024,
      source: 'plugin:x',
    })
    expect(result.magnets).toHaveLength(3)
    const ed2k = result.magnets.find(m => m.kind === 'ed2k')
    expect(ed2k).toMatchObject({
      origin: 'pansou',
      title: '示例.mkv',
      hash: '0123456789abcdef0123456789abcdef',
      size: 734003200,
      datetime: undefined,
    })
    expect(result.magnets.find(m => m.title === 'base32')?.hash).toMatch(
      /^[0-9a-f]{40}$/
    )
  })

  it('界面搜索要 115 + magnet + ed2k；追更（默认）只要 115', async () => {
    const { fetch, sent } = fakeFetch({
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    await searchPanSou(fetch, 'https://so.example.com', 'a', true)
    await searchPanSou(fetch, 'https://so.example.com', 'a')
    expect(JSON.parse(sent[0].body).cloud_types).toEqual([
      '115',
      'magnet',
      'ed2k',
    ])
    expect(JSON.parse(sent[1].body).cloud_types).toEqual(['115'])
  })
})

describe('searchPanSou', () => {
  it('默认不配置 PanSou 地址（不把关键词默认发给第三方）；公共实例由用户显式选用', () => {
    expect(defaultValues()['pan115.pansouUrl']).toBe('')
    expect(PANSOU_PUBLIC_URL).toMatch(/^https:\/\//)
  })

  it('地址：补 /api/search，去掉末尾斜杠，只接受 http(s)', () => {
    expect(panSouEndpoint('https://so.example.com/')).toBe(
      'https://so.example.com/api/search'
    )
    expect(panSouEndpoint(' http://192.168.1.5:8888 ')).toBe(
      'http://192.168.1.5:8888/api/search'
    )
    expect(() => panSouEndpoint('')).toThrow('PanSou')
    expect(() => panSouEndpoint('ftp://x')).toThrow('PanSou')
  })

  it('POST JSON：kw、只要 115、merge 结果；重定向手动处理', async () => {
    const { fetch, sent } = fakeFetch({
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    const { shares } = await searchPanSou(
      fetch,
      'https://so.example.com',
      ' 纪录片 '
    )
    expect(shares).toHaveLength(2)
    expect(sent[0].method).toBe('POST')
    expect(sent[0].headers['content-type']).toContain('application/json')
    expect(JSON.parse(sent[0].body)).toEqual({
      kw: '纪录片',
      cloud_types: ['115'],
      res: 'merge',
    })
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      redirect: 'manual',
    })
  })

  it('跨主机重定向（如指向内网元数据地址）被拦截，不跟过去', async () => {
    const { fetch, sent } = fakeFetch({
      'https://so.example.com/api/search': new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
      'http://169.254.169.254': { code: 0, data: {} },
    })
    await expect(
      searchPanSou(fetch, 'https://so.example.com', 'a')
    ).rejects.toThrow('重定向')
    expect(sent.map(r => r.url)).toEqual(['https://so.example.com/api/search'])
  })

  it('同主机重定向照常跟随，POST 体保留', async () => {
    const { fetch, sent } = fakeFetch({
      'http://so.example.com/api/search': new Response(null, {
        status: 307,
        headers: { location: 'https://so.example.com/api/search' },
      }),
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    const { shares } = await searchPanSou(
      fetch,
      'http://so.example.com',
      '纪录片'
    )
    expect(shares).toHaveLength(2)
    expect(sent[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(sent[1].body).kw).toBe('纪录片')
  })

  it('HTTP 失败转成人话', async () => {
    const { fetch } = fakeFetch({
      'https://so.example.com': new Response('x', { status: 502 }),
    })
    await expect(
      searchPanSou(fetch, 'https://so.example.com', 'a')
    ).rejects.toThrow('PanSou 返回 HTTP 502')
  })

  /** 挂住不回的请求：只在超时信号触发时以底层错误结束 */
  const hang = (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('net::ERR_ABORTED'))
      )
    )

  it('请求挂住超时后重新发起，第二次拿到结果', async () => {
    const fetch = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(hang)
      .mockResolvedValueOnce(Response.json(PANSOU_WRAPPED))
    const { shares } = await searchPanSou(
      fetch,
      'https://so.example.com',
      '纪录片',
      true,
      10
    )
    expect(shares).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
    // 两次发的是同一个请求体
    const bodies = fetch.mock.calls.map(([, init]) => init?.body)
    expect(bodies[0]).toBe(bodies[1])
  })

  it(`一直超时：发满 ${PANSOU_ATTEMPTS} 次后报超时`, async () => {
    const fetch = vi.fn(hang)
    const error = await searchPanSou(
      fetch,
      'https://so.example.com',
      'a',
      true,
      10
    ).catch((e: unknown) => e)
    expect((error as Pan115Error).timeout).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(PANSOU_ATTEMPTS)
  })

  it('5xx 与连不上重试，4xx 不重试', async () => {
    const flaky = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('x', { status: 502 }))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(Response.json(PANSOU_WRAPPED))
    const { shares } = await searchPanSou(flaky, 'https://so.example.com', 'a')
    expect(shares).toHaveLength(2)
    expect(flaky).toHaveBeenCalledTimes(3)

    const denied = vi.fn(async () => new Response('x', { status: 403 }))
    await expect(
      searchPanSou(denied, 'https://so.example.com', 'a')
    ).rejects.toThrow('PanSou 返回 HTTP 403')
    expect(denied).toHaveBeenCalledTimes(1)
  })
})

describe('fetchJson', () => {
  it('超时：无论底层抛出什么错误名，都按超时处理（Electron net.fetch 不一定是 TimeoutError）', async () => {
    const fetch = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('net::ERR_ABORTED'))
        )
      )
    const error = await fetchJson(fetch, '115', 'https://x', {}, 10).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(Pan115Error)
    expect((error as Pan115Error).timeout).toBe(true)
    expect((error as Pan115Error).message).toBe('115 请求超时')
  })

  it('连不上与不是 JSON 分开报', async () => {
    await expect(
      fetchJson(async () => Promise.reject(new Error('boom')), 'PanSou', 'x')
    ).rejects.toThrow('PanSou 连不上')
    await expect(
      fetchJson(async () => new Response('<html>'), 'PanSou', 'x')
    ).rejects.toThrow('不是 JSON')
  })
})

describe('errnoMessage', () => {
  it('常见错误码', () => {
    expect(errnoMessage(4100024)).toContain('已经接收过')
    expect(errnoMessage(4100008)).toContain('提取码')
    expect(errnoMessage(4100010)).toContain('取消')
    expect(errnoMessage(4100018)).toContain('过期')
    expect(errnoMessage(911)).toContain('安全验证')
    expect(errnoMessage(99)).toContain('重新扫码登录')
    expect(errnoMessage(990001)).toContain('重新扫码登录')
  })

  it('不认识的错误码用 115 的原文，再没有就带上错误码', () => {
    expect(errnoMessage(123, '空间不足')).toBe('空间不足')
    expect(errnoMessage(123)).toBe('115 返回错误（123）')
  })
})
