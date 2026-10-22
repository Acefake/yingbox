import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  NO_TRAILER_TTL_MS,
  TRAILER_TTL_MS,
  createDoubanTrailers,
  findTrailerPageId,
  findTrailerVideo,
  parseRexxarTrailer,
} from '../src/engine/online/douban-trailer'
import { online } from '../src/shared/contract/online'
import type { NetClient } from '../src/shared/net/client'
import { HttpStatusError } from '../src/shared/net/client'
import { refererFor } from '../src/shared/net/media-referer'

/**
 * 豆瓣预告片：先 m.douban.com rexxar 接口（移动 UA + Referer），失败再解析
 * movie.douban.com 预告片列表页 → 预告片页的 <video><source>。
 * 结果（含「无预告」）内存 + 落盘缓存；接口连续失败熔断。
 * 沙箱在海外、豆瓣会 302 到验证页，这里全部用假网络（夹具是按豆瓣页面结构手写的最小样例）。
 */

const MP4 =
  'https://vt1.doubanio.com/202610221200/0a1b2c3d4e5f/view/movie/M/703160001.mp4'

const REXXAR_WITH_TRAILER = {
  id: '35267208',
  title: '流浪地球2',
  trailer: { id: '300001', title: '定档预告', video_url: MP4 },
  trailers: [{ id: '300001', video_url: MP4 }],
}

const TRAILER_LIST_HTML = `
<h1><a href="https://movie.douban.com/subject/1292052/">肖申克的救赎</a> 的预告片·花絮·片段</h1>
<div class="mod">
  <ul class="video-list">
    <li class="video-list-col">
      <a class="pr-video" href="https://movie.douban.com/trailer/300777/#content" title="终极预告"></a>
    </li>
    <li><a class="pr-video" href="https://movie.douban.com/trailer/300778/#content"></a></li>
  </ul>
</div>`

const TRAILER_PAGE_HTML = `
<div class="video-wrapper">
  <video id="movie_player" width="640" height="360" controls poster="https://img1.doubanio.com/x.jpg">
    <source src="${MP4}" type="video/mp4">
  </video>
</div>`

interface Request {
  url: string
  headers: Record<string, string>
}

type Reply = unknown | Error

/** 假网络：按地址前缀回复；记录每次请求。 */
function fakeNet(routes: Record<string, Reply | (() => Reply)>): NetClient & {
  requests: Request[]
} {
  const requests: Request[] = []
  const reply = (url: string, headers: Record<string, string> = {}): Reply => {
    requests.push({ url, headers })
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
    if (!key) return new HttpStatusError(404)
    const r = routes[key]
    return typeof r === 'function' ? (r as () => Reply)() : r
  }
  return {
    requests,
    open: () => Promise.reject(new Error('unused')),
    request: () => Promise.reject(new Error('unused')),
    async getText(url, req) {
      const r = reply(url, req?.headers)
      if (r instanceof Error) throw r
      if (r && typeof r === 'object' && 'redirect' in r) {
        const { redirect, text } = r as { redirect: string; text: string }
        return { text, url: redirect, status: 200 }
      }
      return { text: String(r), url, status: 200 }
    },
    async getJson<T>(url: string, req?: { headers?: Record<string, string> }) {
      const r = reply(url, req?.headers)
      if (r instanceof Error) throw r
      return r as T
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-douban-'))
})
const cacheFile = (): string => join(dir, 'douban-trailers.json')

describe('解析', () => {
  it('rexxar：trailer.video_url，其次 trailers[]；没有预告返回 null；结构不对返回 undefined', () => {
    expect(parseRexxarTrailer(REXXAR_WITH_TRAILER)).toBe(MP4)
    expect(parseRexxarTrailer({ trailers: [{ video_url: MP4 }] })).toBe(MP4)
    expect(parseRexxarTrailer({ id: '1', trailer: null, trailers: [] })).toBe(
      null
    )
    expect(parseRexxarTrailer({ title: 'x' })).toBe(null)
    expect(parseRexxarTrailer('<html>')).toBeUndefined()
    expect(
      parseRexxarTrailer({ msg: 'need_login', code: 1001 })
    ).toBeUndefined()
    // 只认 https 的 mp4
    expect(
      parseRexxarTrailer({ trailer: { video_url: 'http://x/a.mp4' } })
    ).toBe(null)
  })

  it('预告片列表页取第一个 /trailer/<tid>/；预告片页取 <video><source src=…mp4>', () => {
    expect(findTrailerPageId(TRAILER_LIST_HTML)).toBe('300777')
    expect(findTrailerPageId('<div>暂无预告片</div>')).toBeNull()
    expect(findTrailerVideo(TRAILER_PAGE_HTML)).toBe(MP4)
    expect(
      findTrailerVideo(`<video><source type="video/mp4" src='${MP4}'></video>`)
    ).toBe(MP4)
    expect(findTrailerVideo('<video poster="a.jpg"></video>')).toBeNull()
  })
})

describe('取预告', () => {
  it('rexxar 成功：带 Referer m.douban.com 与移动 UA，movie / tv 路径不同', async () => {
    const net = fakeNet({
      'https://m.douban.com/rexxar/api/v2/movie/35267208': REXXAR_WITH_TRAILER,
      'https://m.douban.com/rexxar/api/v2/tv/26794435': {
        trailers: [{ video_url: MP4 }],
      },
    })
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('35267208', 'movie')).toBe(MP4)
    expect(await trailers.get('26794435', 'tv')).toBe(MP4)
    expect(net.requests).toHaveLength(2)
    const headers = net.requests[0].headers
    expect(headers.Referer).toBe('https://m.douban.com/')
    expect(headers['User-Agent']).toMatch(/Mobile/)
  })

  it('rexxar 失败（302 到验证页 / 403）→ 解析预告片列表页与预告片页', async () => {
    const net = fakeNet({
      'https://m.douban.com/': new HttpStatusError(403),
      'https://movie.douban.com/subject/1292052/trailer': TRAILER_LIST_HTML,
      'https://movie.douban.com/trailer/300777/': TRAILER_PAGE_HTML,
    })
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('1292052', 'movie')).toBe(MP4)
    expect(net.requests.map(r => r.url)).toEqual([
      'https://m.douban.com/rexxar/api/v2/movie/1292052',
      'https://movie.douban.com/subject/1292052/trailer',
      'https://movie.douban.com/trailer/300777/',
    ])
  })

  it('rexxar 返回了条目但没有预告：记为无预告，不再翻网页', async () => {
    const net = fakeNet({
      'https://m.douban.com/': { id: '1', title: '冷门片', trailers: [] },
    })
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('1', 'movie')).toBeNull()
    expect(net.requests).toHaveLength(1)
  })

  it('网页兜底也没有预告片：无预告', async () => {
    const net = fakeNet({
      'https://m.douban.com/': new Error('timeout'),
      'https://movie.douban.com/subject/2/trailer':
        '<a href="https://movie.douban.com/subject/2/">返回</a><p>暂无预告片</p>',
    })
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('2', 'movie')).toBeNull()
  })

  it('列表页被 302 到验证页（sec.douban.com）：算失败，不当成无预告缓存', async () => {
    let verified = false
    const net = fakeNet({
      'https://m.douban.com/': new HttpStatusError(403),
      'https://movie.douban.com/subject/1292052/trailer': () =>
        verified
          ? TRAILER_LIST_HTML
          : { redirect: 'https://sec.douban.com/b?r=x', text: '<p>验证</p>' },
      'https://movie.douban.com/trailer/300777/': TRAILER_PAGE_HTML,
    })
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('1292052', 'movie')).toBeNull()
    verified = true
    expect(await trailers.get('1292052', 'movie')).toBe(MP4)
  })

  it('结果（含无预告）缓存在内存，同一条目并发与再次请求都只发一次', async () => {
    const net = fakeNet({
      'https://m.douban.com/rexxar/api/v2/movie/3': REXXAR_WITH_TRAILER,
      'https://m.douban.com/rexxar/api/v2/movie/4': { trailers: [] },
    })
    const trailers = createDoubanTrailers({ net })
    const [a, b] = await Promise.all([
      trailers.get('3', 'movie'),
      trailers.get('3', 'movie'),
    ])
    expect([a, b]).toEqual([MP4, MP4])
    expect(await trailers.get('3', 'movie')).toBe(MP4)
    expect(await trailers.get('4', 'movie')).toBeNull()
    expect(await trailers.get('4', 'movie')).toBeNull()
    expect(net.requests).toHaveLength(2)
  })

  it('落盘缓存：重启后命中（含无预告）；过期后重新请求（预告地址带时效，比无预告短）', async () => {
    let now = 1_000_000
    const routes = {
      'https://m.douban.com/rexxar/api/v2/movie/5': REXXAR_WITH_TRAILER,
      'https://m.douban.com/rexxar/api/v2/movie/6': { trailers: [] },
    }
    const first = createDoubanTrailers({
      net: fakeNet(routes),
      file: cacheFile(),
      now: () => now,
    })
    await first.get('5', 'movie')
    await first.get('6', 'movie')
    await first.flush()
    expect(JSON.parse(readFileSync(cacheFile(), 'utf8'))).toBeTruthy()

    const net = fakeNet(routes)
    const second = createDoubanTrailers({
      net,
      file: cacheFile(),
      now: () => now,
    })
    expect(await second.get('5', 'movie')).toBe(MP4)
    expect(await second.get('6', 'movie')).toBeNull()
    expect(net.requests).toHaveLength(0)

    now += TRAILER_TTL_MS + 1
    expect(TRAILER_TTL_MS).toBeLessThan(NO_TRAILER_TTL_MS)
    await second.get('5', 'movie')
    await second.get('6', 'movie')
    expect(net.requests.map(r => r.url)).toEqual([
      'https://m.douban.com/rexxar/api/v2/movie/5',
    ])
    now += NO_TRAILER_TTL_MS
    await second.get('6', 'movie')
    expect(net.requests).toHaveLength(2)
  })

  it('缓存文件损坏当空', async () => {
    writeFileSync(cacheFile(), '{oops')
    const net = fakeNet({
      'https://m.douban.com/': REXXAR_WITH_TRAILER,
    })
    const trailers = createDoubanTrailers({ net, file: cacheFile() })
    expect(await trailers.get('7', 'movie')).toBe(MP4)
  })

  it('请求失败不缓存；两边都连续失败 3 次后熔断，冷却期内不再发请求', async () => {
    let now = 0
    const net = fakeNet({
      'https://m.douban.com/': new Error('ECONNRESET'),
      'https://movie.douban.com/': new HttpStatusError(403),
    })
    const trailers = createDoubanTrailers({ net, now: () => now })
    for (let i = 0; i < 3; i++)
      expect(await trailers.get(String(100 + i), 'movie')).toBeNull()
    const sent = net.requests.length
    expect(sent).toBe(6)
    expect(await trailers.get('200', 'movie')).toBeNull()
    expect(net.requests.length).toBe(sent)

    // 失败没有被当成「无预告」缓存：冷却过后同一条目会再试
    now += 60 * 60 * 1000
    await trailers.get('100', 'movie')
    expect(net.requests.length).toBeGreaterThan(sent)
  })

  it('条目 ID 只接受数字', async () => {
    const net = fakeNet({})
    const trailers = createDoubanTrailers({ net })
    expect(await trailers.get('../../x', 'movie')).toBeNull()
    expect(net.requests).toHaveLength(0)
  })
})

describe('契约与防盗链', () => {
  it('online.doubanTrailer 校验条目 ID 与类型', () => {
    const { parse } = online.calls.doubanTrailer
    expect(parse(['35267208', 'tv'])).toEqual(['35267208', 'tv'])
    expect(parse(['1'])).toEqual(['1', 'movie'])
    expect(() => parse(['abc', 'movie'])).toThrow()
    expect(() => parse(['1', 'anime'])).toThrow()
  })

  it('doubanio.com 的视频请求补 Referer（只对 doubanio.com）', () => {
    expect(refererFor(MP4)).toBe('https://movie.douban.com/')
    expect(refererFor('https://vt3.doubanio.com/a.mp4')).toBe(
      'https://movie.douban.com/'
    )
    expect(refererFor('https://doubanio.com.evil.com/a.mp4')).toBeUndefined()
    expect(refererFor('https://evildoubanio.com/a.mp4')).toBeUndefined()
  })
})
