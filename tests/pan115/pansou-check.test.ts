/**
 * PanSou 分享有效性检测（主进程）：请求体、响应映射到三种状态、不支持 / 超时 / 报错时静默、
 * 不支持的实例记住不再请求、超时不重试、契约参数校验。全部用假 fetch，不访问外网。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  checkEndpoint,
  checkRequestBody,
  createLinkChecker,
  parseCheckResponse,
  stateOf,
} from '../../src/main/pan115/pansou-check'
import { MAX_LINK_CHECKS, pan115 } from '../../src/shared/contract/pan115'
import { fakeFetch } from './fixtures'

const BASE = 'https://so.example.com'
const A = { url: 'https://115cdn.com/s/swa1?password=ab12', password: 'ab12' }
const B = { url: 'https://115.com/s/swb2', password: '' }
const C = { url: 'https://115.com/s/swc3', password: 'cd34' }

/** README 示例格式的响应 */
const reply = (states: [string, string][]): unknown => ({
  results: states.map(([url, state]) => ({
    disk_type: '115',
    url,
    normalized_url: url,
    state,
    cache_hit: false,
    checked_at: 1,
    expires_at: 2,
    summary: '',
  })),
})

describe('请求与响应格式', () => {
  it('检测地址与搜索共用一个 PanSou 地址', () => {
    expect(checkEndpoint(' https://so.example.com/ ')).toBe(
      'https://so.example.com/api/check/links'
    )
    expect(() => checkEndpoint('so.example.com')).toThrow()
  })

  it('请求体：disk_type 固定 115，提取码有才带', () => {
    expect(JSON.parse(checkRequestBody([A, B]))).toEqual({
      items: [
        { disk_type: '115', url: A.url, password: 'ab12' },
        { disk_type: '115', url: B.url },
      ],
    })
  })

  it('state 只认 ok / bad / locked，其余为 unknown', () => {
    expect(
      ['ok', 'bad', 'locked', 'uncertain', 'unsupported', 1].map(stateOf)
    ).toEqual(['ok', 'bad', 'locked', 'unknown', 'unknown', 'unknown'])
  })

  it('按 url 对应请求，缺 url 按下标；多余、重复的结果丢掉；兼容 data 外壳', () => {
    const json = reply([
      [B.url, 'bad'],
      ['https://115.com/s/other', 'ok'],
      [B.url, 'ok'],
    ])
    expect(parseCheckResponse(json, [A, B])).toEqual([
      { url: B.url, state: 'bad' },
    ])
    expect(parseCheckResponse({ results: [{ state: 'locked' }] }, [C])).toEqual(
      [{ url: C.url, state: 'locked' }]
    )
    expect(
      parseCheckResponse({ code: 0, data: reply([[A.url, 'ok']]) }, [A])
    ).toEqual([{ url: A.url, state: 'ok' }])
    expect(parseCheckResponse({ results: 'x' }, [A])).toEqual([])
  })
})

describe('createLinkChecker', () => {
  it('POST 到 /api/check/links，返回三种状态；非 115 链接不送', async () => {
    const { fetch, sent } = fakeFetch({
      [`${BASE}/api/check/links`]: reply([
        [A.url, 'ok'],
        [B.url, 'bad'],
        [C.url, 'locked'],
      ]),
    })
    const checker = createLinkChecker(fetch, () => BASE)
    const result = await checker.checkLinks([
      A,
      B,
      C,
      { url: 'https://pan.quark.cn/s/x', password: '' },
    ])
    expect(result).toEqual({
      supported: true,
      results: [
        { url: A.url, state: 'ok' },
        { url: B.url, state: 'bad' },
        { url: C.url, state: 'locked' },
      ],
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe('POST')
    expect(sent[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(sent[0].body).items).toHaveLength(3)
  })

  it.each([404, 405])(
    '实例没有接口（%i）：返回不支持并记住，不再请求',
    async status => {
      const fetch = vi.fn(
        async () => new Response('404 page not found', { status })
      )
      const checker = createLinkChecker(fetch, () => BASE)
      expect(await checker.checkLinks([A])).toEqual({ supported: false })
      expect(await checker.checkLinks([B])).toEqual({ supported: false })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('换了 PanSou 地址会重新尝试', async () => {
    let base = BASE
    const fetch = vi.fn(async (url: string) =>
      url.startsWith(BASE)
        ? new Response('', { status: 404 })
        : Response.json(reply([[A.url, 'ok']]))
    )
    const checker = createLinkChecker(fetch, () => base)
    await checker.checkLinks([A])
    base = 'http://192.168.1.10:8888'
    expect(await checker.checkLinks([A])).toEqual({
      supported: true,
      results: [{ url: A.url, state: 'ok' }],
    })
  })

  it('没填地址或地址不合法：不支持，不发请求', async () => {
    const fetch = vi.fn()
    expect(await createLinkChecker(fetch, () => '').checkLinks([A])).toEqual({
      supported: false,
    })
    expect(
      await createLinkChecker(fetch, () => 'ftp://x').checkLinks([A])
    ).toEqual({ supported: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('超时只发一次、不重试，返回空结果', async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('net::ERR_ABORTED'))
          )
        )
    )
    const checker = createLinkChecker(hang, () => BASE, 10)
    expect(await checker.checkLinks([A])).toEqual({
      supported: true,
      results: [],
    })
    expect(hang).toHaveBeenCalledTimes(1)
  })

  it('5xx、401、连不上、非 JSON：静默返回空结果，下次照常请求', async () => {
    const fetch = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('x', { status: 502 }))
      .mockResolvedValueOnce(new Response('x', { status: 401 }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    const checker = createLinkChecker(fetch, () => BASE)
    for (let i = 0; i < 4; i++)
      expect(await checker.checkLinks([A])).toEqual({
        supported: true,
        results: [],
      })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

describe('契约 checkLinks 参数', () => {
  const parse = pan115.calls.checkLinks.parse

  it('补齐缺省提取码、截断过长字段', () => {
    expect(parse([[{ url: A.url }]])).toEqual([[{ url: A.url, password: '' }]])
    const [[item]] = parse([
      [{ url: 'x'.repeat(5000), password: 'p'.repeat(99) }],
    ])
    expect(item.url).toHaveLength(2048)
    expect(item.password).toHaveLength(32)
  })

  it(`不是数组、超过 ${MAX_LINK_CHECKS} 条、url 不是字符串时拒绝`, () => {
    expect(() => parse(['x'])).toThrow()
    const many = Array.from({ length: MAX_LINK_CHECKS + 1 }, () => A)
    expect(() => parse([many])).toThrow()
    expect(() => parse([[{ url: 1 }]])).toThrow()
  })
})
