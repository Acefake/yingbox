/**
 * 番号元数据源的附加能力：按主机分开的出网客户端、领取会话 Cookie（GIGA 用）、给没头像的演员补头像。
 */
import { describe, expect, it } from 'vitest'
import { ProviderHttp } from '../../../src/main/library/providers/http/provider-http'
import type { ActorSource } from '../../../src/main/library/providers/jav/actors'
import { JavProvider } from '../../../src/main/library/providers/jav/jav-provider'
import type {
  JavRecord,
  JavSite,
} from '../../../src/main/library/providers/jav/types'
import { DEFAULT_JAV_SETTINGS } from '../../../src/shared/library/ipc'

const record = (actors: JavRecord['actors']): JavRecord => ({
  site: 'javbus',
  code: 'SSIS-497',
  url: 'https://javbus/SSIS-497',
  title: 't',
  tags: [],
  actors,
  stills: [],
})

/** 返回固定页面的假 fetch，记录每次请求的地址与重定向方式。 */
function fakeHttp(
  respond: (url: string) => { status: number; cookies?: string[] }
): { http: ProviderHttp; calls: Array<{ url: string; redirect?: string }> } {
  const calls: Array<{ url: string; redirect?: string }> = []
  const http = new ProviderHttp({
    fetch: async (url, init) => {
      calls.push({ url, redirect: init.redirect })
      const r = respond(url)
      return {
        status: r.status,
        headers: {
          get: () => null,
          getSetCookie: () => r.cookies ?? [],
        },
        text: async () => '<html>ok</html>',
      }
    },
  })
  return { http, calls }
}

describe('JavProvider 附加能力', () => {
  it('issuedCookies：不跟随重定向，只留 name=value', async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 302,
      cookies: ['PHPSESSID=abc; path=/; HttpOnly', 'WSLB=1; Secure'],
    }))
    let got: string[] = []
    const probe: JavSite = {
      id: 'giga',
      supports: () => true,
      fetch: async (_code, ctx) => {
        got = (await ctx.issuedCookies?.('https://giga.example/age')) ?? []
        return null
      },
    }
    await new JavProvider({
      http,
      sites: [probe],
      settings: () => ({ sites: [{ id: 'giga', enabled: true }] }),
    }).scrape({ code: 'GHKR-060', kind: 'censored', subtitle: false })
    expect(got).toEqual(['PHPSESSID=abc', 'WSLB=1'])
    expect(calls).toEqual([
      { url: 'https://giga.example/age', redirect: 'manual' },
    ])
  })

  it('按主机取出网客户端', async () => {
    const hosts: string[] = []
    const { http } = fakeHttp(() => ({ status: 200 }))
    const probe: JavSite = {
      id: 'javbus',
      supports: () => true,
      fetch: async (_code, ctx) => {
        await ctx.page('https://a.example/x')
        await ctx.page('https://b.example/y')
        return null
      },
    }
    await new JavProvider({
      http: host => {
        hosts.push(host)
        return http
      },
      sites: [probe],
      settings: () => DEFAULT_JAV_SETTINGS,
    }).scrape({ code: 'SSIS-497', kind: 'censored', subtitle: false })
    expect(hosts).toEqual(['a.example', 'b.example'])
  })

  it('没头像的演员由头像来源补上；来源出错不影响刮削', async () => {
    const site: JavSite = {
      id: 'javbus',
      supports: () => true,
      fetch: async () =>
        record([
          { name: '有头像', photo: 'https://site/p.jpg' },
          { name: '鷲尾めい' },
          { name: '出错的' },
        ]),
    }
    const asked: string[] = []
    const avatars: ActorSource = {
      id: 'gfriends',
      capability: 'image',
      genders: ['female'],
      fetch: async name => {
        asked.push(name)
        if (name === '出错的') throw new Error('被墙')
        return {
          source: 'gfriends',
          name,
          aliases: [],
          images: ['https://g/w.jpg'],
          ids: {},
        } as never
      },
    }
    const { http } = fakeHttp(() => ({ status: 200 }))
    const movie = await new JavProvider({
      http,
      sites: [site],
      avatars,
      settings: () => DEFAULT_JAV_SETTINGS,
    }).scrape({ code: 'SSIS-497', kind: 'censored', subtitle: false })
    expect(asked).toEqual(['鷲尾めい', '出错的'])
    expect(movie?.actors).toEqual([
      { name: '有头像', photo: 'https://site/p.jpg' },
      { name: '鷲尾めい', photo: 'https://g/w.jpg' },
      { name: '出错的' },
    ])
  })
})
