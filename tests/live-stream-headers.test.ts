/**
 * 直播线路自带的请求头：m3u 解析（$备注、#EXTVLCOPT、#KODIPROP、#EXTHTTP、地址后缀 |…）→ 线路地址后缀，
 * 线路方案、桌面代理（yingbox-stream://）、服务端代理（/api/stream，含 m3u8 改写与 SSRF）、探测与 mpv 都带上。
 */
import { describe, expect, it, vi } from 'vitest'

import { planLine } from '../src/renderer/src/features/live/utils/line-plan'
import { parsePlaylist } from '../src/renderer/src/features/live/utils/playlist-parse'
import { probeStream } from '../src/main/iptv/stream-probe'
import { MpvHeaderState, headerArgs, mpvStream } from '../src/main/mpv-stream'
import { createStreamHandler } from '../src/main/stream-proxy'
import { createStreamProxy } from '../src/server/online/stream/route'
import { streamProxyPath } from '../src/shared/engine-http'
import { createNetClient } from '../src/shared/net/client'
import {
  joinStreamHeaders,
  readStreamHeaderQuery,
  splitStreamHeaders,
} from '../src/shared/net/stream-headers'
import { streamUrl } from '../src/shared/stream-url'

const UA = 'Mozilla/5.0 (Kodi) okhttp/3.12'
const REF = 'https://tv.example.com/'
const lookup = async (host: string): Promise<Array<{ address: string }>> =>
  host === 'nas.lan'
    ? [{ address: '192.168.1.2' }]
    : [{ address: '93.184.216.34' }]

const urlsOf = (text: string): string[] =>
  parsePlaylist(text).channels.flatMap(channel => channel.urls)

describe('m3u 解析', () => {
  it('地址后的 $备注 去掉，和 txt 一致', () => {
    expect(
      urlsOf('#EXTM3U\n#EXTINF:-1,CCTV1\nhttp://a.com/1.m3u8$电信线路\n')
    ).toEqual(['http://a.com/1.m3u8'])
  })

  it('地址里合法的 $ 不当备注截掉', () => {
    expect(
      urlsOf(
        '#EXTM3U\n#EXTINF:-1,A\nhttp://a.com/1.m3u8?token=$abc\n#EXTINF:-1,B\nhttp://a.com/$x/2.m3u8\n'
      )
    ).toEqual(['http://a.com/1.m3u8?token=$abc', 'http://a.com/$x/2.m3u8'])
    expect(
      urlsOf('央视,#genre#\nCCTV1,http://a.com/1.m3u8?k=$v$备注\n')
    ).toEqual(['http://a.com/1.m3u8?k=$v'])
  })

  it('#EXTINF 下只有指令、没有地址行的频道：头不串到下一个频道', () => {
    const urls = urlsOf(
      [
        '#EXTM3U',
        '#EXTINF:-1,A',
        `#EXTVLCOPT:http-user-agent=${UA}`,
        '#EXTINF:-1,B',
        'http://a.com/b.m3u8',
      ].join('\n')
    )
    expect(urls).toEqual(['http://a.com/b.m3u8'])
  })

  it('#EXTVLCOPT 的 http-user-agent / http-referrer 挂到线路上，只管下一条地址', () => {
    const urls = urlsOf(
      [
        '#EXTM3U',
        '#EXTINF:-1,A',
        `#EXTVLCOPT:http-user-agent=${UA}`,
        `#EXTVLCOPT:http-referrer=${REF}`,
        'http://a.com/a.m3u8',
        '#EXTINF:-1,B',
        'http://a.com/b.m3u8',
      ].join('\n')
    )
    expect(splitStreamHeaders(urls[0])).toEqual({
      url: 'http://a.com/a.m3u8',
      headers: { userAgent: UA, referer: REF },
    })
    expect(urls[1]).toBe('http://a.com/b.m3u8')
  })

  it('#KODIPROP stream_headers、#EXTHTTP、#EXTINF 属性都认；写在 #EXTINF 前也行', () => {
    const urls = urlsOf(
      [
        '#EXTM3U',
        `#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=${encodeURIComponent(UA)}&Referer=${REF}`,
        '#EXTINF:-1,A',
        'http://a.com/a.m3u8',
        '#EXTINF:-1,B',
        `#EXTHTTP:{"User-Agent":"${UA}","Cookie":"x=1"}`,
        'http://a.com/b.m3u8',
        `#EXTINF:-1 http-referrer="${REF}",C`,
        'http://a.com/c.m3u8',
      ].join('\n')
    )
    expect(splitStreamHeaders(urls[0]).headers).toEqual({
      userAgent: UA,
      referer: REF,
    })
    // B / C 只有自己写的头，不继承 A 的
    expect(splitStreamHeaders(urls[1]).headers).toEqual({ userAgent: UA })
    expect(splitStreamHeaders(urls[2]).headers).toEqual({ referer: REF })
  })

  it('写在 #EXTINF 前的指令不继承给后面的频道', () => {
    const urls = urlsOf(
      [
        '#EXTM3U',
        `#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=${encodeURIComponent(UA)}`,
        '#EXTINF:-1,A',
        'http://a.com/a.m3u8',
        '#EXTINF:-1,B',
        'http://a.com/b.m3u8',
      ].join('\n')
    )
    expect(splitStreamHeaders(urls[0]).headers).toEqual({ userAgent: UA })
    expect(urls[1]).toBe('http://a.com/b.m3u8')
  })

  it('地址后缀 |User-Agent=… 优先于指令行；txt 里同样认', () => {
    const m3u = urlsOf(
      `#EXTM3U\n#EXTINF:-1,A\n#EXTVLCOPT:http-user-agent=old\nhttp://a.com/a.m3u8|User-Agent=new&Referer=${REF}\n`
    )
    expect(splitStreamHeaders(m3u[0]).headers).toEqual({
      userAgent: 'new',
      referer: REF,
    })
    const txt = urlsOf(
      `央视,#genre#\nCCTV1,http://a.com/1.m3u8|user-agent=${encodeURIComponent(UA)}$备注\n`
    )
    expect(splitStreamHeaders(txt[0])).toEqual({
      url: 'http://a.com/1.m3u8',
      headers: { userAgent: UA },
    })
  })

  it('只认 UA / Referer：Cookie 等忽略，控制字符去掉，Referer 不是 http(s) 丢弃', () => {
    const [url] = urlsOf(
      '#EXTM3U\n#EXTINF:-1,A\nhttp://a.com/a.m3u8|Cookie=x&User-Agent=a%0D%0AX-Evil:1&Referer=javascript:1\n'
    )
    expect(splitStreamHeaders(url).headers).toEqual({ userAgent: 'aX-Evil:1' })
  })

  it('| 后面是不认识的头（Cookie 等）时照样拆出地址，头丢弃；不像头参数时整条当地址', () => {
    expect(splitStreamHeaders('http://a.com/x.m3u8|Cookie=a%3Db')).toEqual({
      url: 'http://a.com/x.m3u8',
    })
    expect(splitStreamHeaders('http://a.com/x|y')).toEqual({
      url: 'http://a.com/x|y',
    })
  })
})

describe('线路方案', () => {
  const line = joinStreamHeaders('http://a.com/live.flv', {
    userAgent: UA,
    referer: REF,
  })

  it('video 换成带 ua / referer 参数的代理地址；hls 与网页端保留后缀交给播放器', () => {
    const video = planLine(line, { ok: true, kind: 'mp4' })
    expect(video.mode).toBe('video')
    const params = new URL(video.src).searchParams
    expect(params.get('src')).toBe('http://a.com/live.flv')
    expect(readStreamHeaderQuery(params)).toEqual({
      userAgent: UA,
      referer: REF,
    })
    expect(planLine(line, { ok: true, kind: 'hls' }).src).toBe(line)
    expect(planLine(line, null).src).toBe(line)
  })
})

describe('代理带上线路请求头', () => {
  it('桌面 yingbox-stream:// 按 ua / referer 参数发请求，覆盖按源注入的 Referer', async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response('x')
    )
    const handler = createStreamHandler(createNetClient({ lookup, fetch }))
    await handler(
      new Request(
        streamUrl('https://surrit.com/a.ts', { userAgent: UA, referer: REF })
      )
    )
    const headers = new Headers(fetch.mock.calls[0][1].headers)
    expect(headers.get('user-agent')).toBe(UA)
    expect(headers.get('referer')).toBe(REF)
  })

  it('服务端 /api/stream：请求带头，改写后的分片地址带同样参数；内网目标照样 403', async () => {
    const seen: Headers[] = []
    const proxy = createStreamProxy({
      allowPrivate: [],
      lookup,
      logFailure: () => {},
      fetch: async (url, init) => {
        seen.push(new Headers(init.headers))
        if (String(url).endsWith('.ts'))
          return new Response('ts', {
            headers: { 'content-type': 'video/mp2t' },
          })
        return new Response('#EXTM3U\n#EXTINF:5,\nseg1.ts\n', {
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        })
      },
    })
    const headers = { userAgent: UA, referer: REF }
    const get = (src: string): Promise<Response> => {
      const url = new URL(
        `http://127.0.0.1:31480${streamProxyPath(src, headers)}`
      )
      return proxy(new Request(url), url)
    }
    const response = await get('https://cdn.example.com/live/index.m3u8')
    expect(seen[0].get('user-agent')).toBe(UA)
    expect(seen[0].get('referer')).toBe(REF)
    const segment = (await response.text()).split('\n')[2]
    expect(segment).toBe(
      streamProxyPath('https://cdn.example.com/live/seg1.ts', headers)
    )
    // 按改写出的分片地址再请求一次：分片请求也带上 ua / referer
    const segmentUrl = new URL(`http://127.0.0.1:31480${segment}`)
    expect((await proxy(new Request(segmentUrl), segmentUrl)).status).toBe(200)
    expect(seen[1].get('user-agent')).toBe(UA)
    expect(seen[1].get('referer')).toBe(REF)
    expect((await get('http://nas.lan/a.m3u8')).status).toBe(403)
    expect(seen).toHaveLength(2)
  })

  it('探测拆开后缀，带头请求原地址', async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('#EXTM3U\n', {
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        })
    )
    const result = await probeStream(
      createNetClient({ lookup, fetch }),
      joinStreamHeaders('https://a.com/live.m3u8', { userAgent: UA })
    )
    expect(result.ok).toBe(true)
    expect(fetch.mock.calls[0][0]).toBe('https://a.com/live.m3u8')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('user-agent')).toBe(
      UA
    )
  })

  it('mpv：拆掉后缀，转成 --user-agent / --referrer', () => {
    const stream = mpvStream({
      url: joinStreamHeaders('https://a.com/x.m3u8', {
        userAgent: UA,
        referer: REF,
      }),
    })
    expect(stream).toEqual({
      target: 'https://a.com/x.m3u8',
      headers: { referrer: REF, 'user-agent': UA },
    })
    expect(headerArgs(stream.headers)).toEqual([
      `--referrer=${REF}`,
      `--user-agent=${UA}`,
    ])
    expect(mpvStream({ url: 'https://b.com/y.mp4' }).headers).toEqual({})
    expect(mpvStream({ filePath: '/v/a.mkv' })).toEqual({
      target: '/v/a.mkv',
      headers: {},
    })
  })

  it('mpv 已运行换片：只在带头时设置，先记下原值；换到不带头的线路时还原，没改过的不碰', async () => {
    const props: Record<string, string> = {
      'user-agent': 'my-conf-ua',
      referrer: '',
    }
    const set = vi.fn(async (name: string, value: string) => {
      props[name] = value
    })
    const state = new MpvHeaderState(async name => props[name], set)
    state.reset()
    await state.apply({})
    expect(set).not.toHaveBeenCalled()
    await state.apply({ 'user-agent': UA })
    expect(props['user-agent']).toBe(UA)
    await state.apply({ 'user-agent': 'other' })
    await state.apply({})
    expect(props['user-agent']).toBe('my-conf-ua')
    expect(set.mock.calls.map(call => call[0])).not.toContain('referrer')
  })

  it('mpv 新进程命令行带了头：换到不带头的线路时还原成 mpv 默认值', async () => {
    const set = vi.fn(async (_name: string, _value: string) => {})
    const state = new MpvHeaderState(async () => 'x', set)
    state.reset({ referrer: REF })
    await state.apply({})
    expect(set.mock.calls).toEqual([['referrer', '']])
  })
})
