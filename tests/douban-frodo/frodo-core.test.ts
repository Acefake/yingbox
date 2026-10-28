/**
 * 豆瓣 frodo 数据源（shared/douban/frodo）：签名固定输入与预期值一致、rexxar 地址换 frodo、
 * 响应映射（真实接口裁剪的夹具）、回退策略、开关。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FRODO_SWITCH_ENV,
  createSourceCooldown,
  describeFailure,
  frodoEnabled,
  frodoRequest,
  frodoSignature,
  isEmptySearch,
  mapList,
  mapSearch,
  mapSubject,
  rexxarToFrodo,
  withFrodoFallback,
} from '../../src/shared/douban/frodo'
import { FRODO_API_KEY, quoteAll } from '../../src/shared/douban/frodo/sign'
import { HttpStatusError } from '../../src/shared/net/client'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/douban/${name}.json`, 'utf8'))

describe('签名', () => {
  it('固定 ts 时与参考实现（Python hmac + quote(path, safe="")）算出的值一致', () => {
    // 期望值由 Python hmac 与 URL 编码计算
    expect(frodoSignature('/api/v2/search/movie', '1761475200')).toBe(
      'enT2ro/nHZdyq8TbVu/WlmM/Pwk='
    )
    expect(frodoSignature('/api/v2/movie/3742360', '1761475200')).toBe(
      'JTTrX7OvIRHhtGuo1DnoJ6q/P50='
    )
    // _ts 使用 YYYYMMDD 字符串时，签名规则相同
    expect(frodoSignature('/api/v2/movie/recommend', '20251026')).toBe(
      'D4G86kRCtJKaQHBOMxsvS7J9iHk='
    )
  })

  it('路径编码与 Python quote(safe="") 一致：/ 也编码，!\'()* 不放过', () => {
    expect(quoteAll('/api/v2/a b')).toBe('%2Fapi%2Fv2%2Fa%20b')
    expect(quoteAll("x!'()*")).toBe('x%21%27%28%29%2A')
  })

  it('frodoRequest：秒级 _ts、apikey、_sig 追加在业务参数后，带 Android UA、不带 Referer', () => {
    const r = frodoRequest(
      '/search/movie',
      { q: '让子弹飞 2010' },
      1761475200_123
    )
    const u = new URL(r.url)
    expect(u.origin + u.pathname).toBe(
      'https://frodo.douban.com/api/v2/search/movie'
    )
    expect(u.searchParams.get('q')).toBe('让子弹飞 2010')
    expect(u.searchParams.get('apikey')).toBe(FRODO_API_KEY)
    expect(u.searchParams.get('_ts')).toBe('1761475200')
    expect(u.searchParams.get('_sig')).toBe('enT2ro/nHZdyq8TbVu/WlmM/Pwk=')
    expect(r.headers['User-Agent']).toMatch(
      /^api-client\/1 com\.douban\.frodo\//
    )
    expect(r.headers.Referer).toBeUndefined()
  })

  it('rexxarToFrodo：同路径同参数换到 frodo；不是 rexxar 地址返回 null', () => {
    const rexxar =
      'https://m.douban.com/rexxar/api/v2/movie/recommend?start=20&count=20&tags=%E7%A7%91%E5%B9%BB&sort=S'
    const r = rexxarToFrodo(rexxar, 1761475200_000)!
    const u = new URL(r.url)
    expect(u.host).toBe('frodo.douban.com')
    expect(u.pathname).toBe('/api/v2/movie/recommend')
    expect(u.searchParams.get('tags')).toBe('科幻')
    expect(u.searchParams.get('start')).toBe('20')
    expect(u.searchParams.get('sort')).toBe('S')
    expect(u.searchParams.get('_sig')).toBe(
      frodoSignature('/api/v2/movie/recommend', '1761475200')
    )
    expect(rexxarToFrodo('https://movie.douban.com/j/x', 0)).toBeNull()
    expect(rexxarToFrodo('https://m.douban.com/movie/', 0)).toBeNull()
    expect(rexxarToFrodo('not a url', 0)).toBeNull()
  })
})

describe('响应映射', () => {
  it('搜索 → rexxar 搜索结构：只留影视条目与要用的字段', () => {
    const body = mapSearch(fixture('frodo-search-movie'))!
    expect(body.items[0]).toEqual({
      target_type: 'movie',
      target: {
        id: '3742360',
        title: '让子弹飞',
        year: '2010',
        card_subtitle:
          '中国大陆 中国香港 / 剧情 喜剧 动作 西部 / 姜文 / 姜文 葛优',
      },
    })
    expect(body.items.every(i => ['movie', 'tv'].includes(i.target_type))).toBe(
      true
    )
    // 幂等：再映射一遍不变（缓存里不区分来源）
    expect(mapSearch(body)).toEqual(body)
    expect(
      mapSearch({ items: [{ target_type: 'person', target: { title: 'x' } }] })
    ).toEqual({ items: [] })
    expect(mapSearch('<html>')).toBeNull()
    expect(isEmptySearch(null)).toBe(true)
    expect(isEmptySearch({ items: [] })).toBe(true)
    expect(isEmptySearch(fixture('frodo-search-movie'))).toBe(false)
  })

  it('列表 → rexxar 列表结构：片单卡保留 type 交给解析层过滤，total 透传', () => {
    const body = mapList(fixture('frodo-recommend-movie'))!
    expect(body.total).toBe(501)
    expect(body.items[0]).toMatchObject({ id: 'movie_scifi', type: 'chart' })
    expect(body.items[1]).toMatchObject({
      id: '37068446',
      type: 'movie',
      title: '生化危机：爆发夜',
      year: '2026',
      rating: { value: 7.3, count: 201389 },
    })
    expect(body.items[1].pic?.normal).toMatch(/doubanio\.com/)
    expect(mapList({ items: [{ id: '1', title: 'x' }] })).toEqual({
      items: [
        {
          id: '1',
          title: 'x',
          year: '',
          card_subtitle: '',
          cover_url: '',
          pic: null,
          rating: null,
        },
      ],
    })
    expect(mapList({ msg: 'invalid_request_996' })).toBeNull()
  })

  it('详情 → 类型、地区、年份', () => {
    expect(mapSubject(fixture('frodo-movie-detail'))).toMatchObject({
      id: '3742360',
      kind: 'movie',
      title: '让子弹飞',
      year: '2010',
      genres: ['剧情', '喜剧', '动作'],
      countries: ['中国大陆', '中国香港'],
    })
    expect(mapSubject({ id: '1' })).toBeNull()
    expect(mapSubject({ id: '2', title: 'x', is_tv: true })?.kind).toBe('tv')
  })
})

describe('回退策略', () => {
  const run = (
    rexxar: () => Promise<string[]>,
    frodo: () => Promise<string[]>,
    extra: { enabled?: boolean; signal?: AbortSignal } = {}
  ): Promise<{ value: string[] | Error; logs: string[] }> => {
    const logs: string[] = []
    return withFrodoFallback({
      enabled: extra.enabled ?? true,
      label: '测试',
      rexxar,
      frodo,
      isEmpty: v => v.length === 0,
      log: m => logs.push(m),
      signal: extra.signal,
    }).then(
      value => ({ value, logs }),
      (error: Error) => ({ value: error, logs })
    )
  }
  const ok = (v: string[]) => () => Promise.resolve(v)
  const fail = (e: unknown) => () => Promise.reject(e)

  it('rexxar 成功不碰 frodo、不打日志', async () => {
    let frodoCalls = 0
    const r = await run(ok(['a']), () => (frodoCalls++, Promise.resolve(['b'])))
    expect(r).toEqual({ value: ['a'], logs: [] })
    expect(frodoCalls).toBe(0)
  })

  it('403 / 418 / 超时 / 验证页 / 空结果都回退到 frodo，日志写明原因', async () => {
    const timeout = Object.assign(new Error('aborted'), {
      name: 'TimeoutError',
    })
    const cases: Array<[() => Promise<string[]>, string]> = [
      [fail(new HttpStatusError(403)), 'HTTP 403'],
      [fail(new HttpStatusError(418)), 'HTTP 418'],
      [fail(timeout), '超时'],
      [fail(new SyntaxError('Unexpected token <')), '验证页'],
      [ok([]), '空结果'],
    ]
    for (const [rexxar, reason] of cases) {
      const r = await run(rexxar, ok(['frodo']))
      expect(r.value).toEqual(['frodo'])
      expect(r.logs).toHaveLength(1)
      expect(r.logs[0]).toContain(reason)
      expect(r.logs[0]).toContain('改走 frodo')
    }
  })

  it('两个都失败：抛 rexxar 的原错误；rexxar 只是空就返回空', async () => {
    const original = new HttpStatusError(403)
    const r = await run(fail(original), fail(new HttpStatusError(500)))
    expect(r.value).toBe(original)
    expect(r.logs[0]).toContain('frodo 也失败（HTTP 500）')
    expect(r.logs[0]).toContain(FRODO_SWITCH_ENV)
    expect((await run(ok([]), fail(new Error('x')))).value).toEqual([])
    expect((await run(ok([]), ok([]))).logs[0]).toContain('也是空结果')
  })

  it('关掉开关：只走 rexxar，错误原样抛出', async () => {
    const original = new HttpStatusError(403)
    const r = await run(fail(original), ok(['frodo']), { enabled: false })
    expect(r).toEqual({ value: original, logs: [] })
  })

  it('调用方取消：不回退', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    let frodoCalls = 0
    const abort = new DOMException('aborted', 'AbortError')
    const r = await run(
      fail(abort),
      () => (frodoCalls++, Promise.resolve([])),
      {
        signal: ctrl.signal,
      }
    )
    expect(r.value).toBe(abort)
    expect(frodoCalls).toBe(0)
  })

  it('冷却：rexxar 出错后冷却期内直接走 frodo；frodo 也挂了再试 rexxar；到期恢复先走 rexxar', async () => {
    let t = 0
    const cooldown = createSourceCooldown(1000, () => t)
    const calls: string[] = []
    let rexxarOk = false
    const once = (frodoOk = true): Promise<string> =>
      withFrodoFallback({
        enabled: true,
        label: '测试',
        cooldown,
        rexxar: async () => {
          calls.push('rexxar')
          if (!rexxarOk) throw new HttpStatusError(403)
          return 'r'
        },
        frodo: async () => {
          calls.push('frodo')
          if (!frodoOk) throw new HttpStatusError(500)
          return 'f'
        },
      })
    expect(await once()).toBe('f')
    expect(await once()).toBe('f')
    expect(calls).toEqual(['rexxar', 'frodo', 'frodo'])
    rexxarOk = true
    calls.length = 0
    expect(await once(false)).toBe('r')
    expect(calls).toEqual(['frodo', 'rexxar'])
    t = 1001
    calls.length = 0
    expect(await once()).toBe('r')
    expect(calls).toEqual(['rexxar'])
  })

  it('describeFailure：状态码、验证页、超时、普通错误', () => {
    expect(describeFailure(new HttpStatusError(418))).toBe('HTTP 418')
    expect(describeFailure({ status: 403, message: 'x' })).toBe('HTTP 403')
    expect(describeFailure(new SyntaxError('x'))).toContain('验证页')
    expect(describeFailure(new Error('连不上'))).toBe('连不上')
  })
})

describe('开关', () => {
  it('默认开；YINGBOX_DOUBAN_FRODO=off / 0 / false / no 关闭', () => {
    expect(frodoEnabled({})).toBe(true)
    expect(frodoEnabled({ YINGBOX_DOUBAN_FRODO: '' })).toBe(true)
    expect(frodoEnabled({ YINGBOX_DOUBAN_FRODO: 'on' })).toBe(true)
    for (const off of ['off', 'OFF', '0', 'false', 'no', ' off '])
      expect(frodoEnabled({ YINGBOX_DOUBAN_FRODO: off })).toBe(false)
  })
})
