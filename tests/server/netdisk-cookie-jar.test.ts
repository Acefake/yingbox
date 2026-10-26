/**
 * 服务端 115 传输层：持久化 Cookie 罐（0600、重启后还在、Set-Cookie 续期 / 删除、只收 115 域）
 * 与 Node 传输（Cookie 头由罐子带、Referer / UA、重定向不出 115 域、同一份登录 Cookie 不重写）。
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CookieJar, parseSetCookie } from '../../src/server/netdisk/cookie-jar'
import { createNodeTransport } from '../../src/server/netdisk/node-transport'
import { PAN115_REFERER } from '../../src/main/pan115/transport'
import { USER_AGENT } from '../../src/main/pan115/http'

let dir: string
let file: string
const NOW = Date.UTC(2026, 9, 26)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-jar-'))
  file = join(dir, 'pan115-cookies.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('CookieJar', () => {
  it('登录 Cookie 落盘为 0600，重新打开后仍在', () => {
    const jar = CookieJar.open(file, () => NOW)
    jar.replace('UID=1_a; CID=c1; SEID=s1; KID=k1')
    if (process.platform !== 'win32')
      expect(statSync(file).mode & 0o777).toBe(0o600)
    const again = CookieJar.open(file, () => NOW)
    expect(again.baseCookie()).toBe('UID=1_a; CID=c1; SEID=s1; KID=k1')
    expect(again.header('https://webapi.115.com/files')).toBe(
      'UID=1_a; CID=c1; SEID=s1; KID=k1'
    )
    // Secure：http 不带，别的站不带
    expect(again.header('http://webapi.115.com/files')).toBe('')
    expect(again.header('https://example.com/')).toBe('')
  })

  it('Set-Cookie 续上新值并落盘；Max-Age=0 删除', () => {
    const jar = CookieJar.open(file, () => NOW)
    jar.replace('UID=1; SEID=old')
    jar.store('https://webapi.115.com/files', [
      'SEID=new; Domain=.115.com; Path=/; Secure; HttpOnly',
      'UID=x; Domain=115.com; Path=/; Max-Age=0',
    ])
    expect(jar.header('https://webapi.115.com/')).toBe('SEID=new')
    const again = CookieJar.open(file, () => NOW)
    expect(again.header('https://webapi.115.com/')).toBe('SEID=new')
    expect(JSON.parse(readFileSync(file, 'utf8')).base).toBe('UID=1; SEID=old')
  })

  it('只收 115 域、Domain 不能越出请求主机；过期的不发', () => {
    expect(
      parseSetCookie('a=1; Domain=evil.com', 'https://webapi.115.com/', NOW)
    ).toBeNull()
    expect(parseSetCookie('a=1', 'https://example.com/', NOW)).toBeNull()
    expect(
      parseSetCookie('a=1; Domain=webapi.115.com', 'https://115.com/', NOW)
    ).toBeNull()
    const hostOnly = parseSetCookie(
      'a=1; Path=/x',
      'https://webapi.115.com/',
      NOW
    )
    expect(hostOnly).toMatchObject({
      domain: 'webapi.115.com',
      hostOnly: true,
      path: '/x',
    })

    let now = NOW
    const jar = CookieJar.open(file, () => now)
    jar.replace('UID=1')
    jar.store('https://webapi.115.com/a', ['T=1; Max-Age=60; Path=/a'])
    expect(jar.header('https://webapi.115.com/a/b')).toBe('T=1; UID=1')
    expect(jar.header('https://webapi.115.com/ab')).toBe('UID=1')
    expect(jar.header('https://passportapi.115.com/a')).toBe('UID=1')
    now += 61_000
    expect(jar.header('https://webapi.115.com/a/b')).toBe('UID=1')
  })

  it('损坏的文件当空罐；replace(null) 清空', () => {
    const jar = CookieJar.open(join(dir, 'missing.json'))
    expect(jar.baseCookie()).toBeNull()
    jar.replace('UID=1')
    jar.replace(null)
    expect(
      CookieJar.open(join(dir, 'missing.json')).header('https://115.com/')
    ).toBe('')
  })
})

describe('createNodeTransport', () => {
  function recorder(
    reply: (url: string) => Response = () => new Response('{}')
  ): {
    fetch: (url: string, init?: RequestInit) => Promise<Response>
    sent: Array<{ url: string; headers: Headers; method: string }>
  } {
    const sent: Array<{ url: string; headers: Headers; method: string }> = []
    return {
      sent,
      fetch: async (url, init) => {
        sent.push({
          url,
          headers: new Headers(init?.headers),
          method: init?.method ?? 'GET',
        })
        expect(init?.redirect).toBe('manual')
        return reply(url)
      },
    }
  }

  it('Cookie 来自罐子（调用方的 Cookie 头被丢掉），Referer / UA 补上', async () => {
    const jar = CookieJar.open(file)
    const { fetch, sent } = recorder()
    const transport = createNodeTransport({ jar, fetch })
    await transport.useCookie('UID=1; SEID=s')
    await transport.fetch('https://webapi.115.com/files', {
      headers: { Cookie: 'hand=written', 'User-Agent': 'x' },
    })
    expect(sent[0].headers.get('cookie')).toBe('UID=1; SEID=s')
    expect(sent[0].headers.get('referer')).toBe(PAN115_REFERER)
    expect(sent[0].headers.get('user-agent')).toBe(USER_AGENT)
  })

  it('非 115 地址直接拒绝；重定向出 115 域被拦下，域内的跟过去并带上新 Cookie', async () => {
    const jar = CookieJar.open(file)
    await expect(
      createNodeTransport({ jar, fetch: recorder().fetch }).fetch(
        'http://192.168.1.1/'
      )
    ).rejects.toThrow('只允许请求 115')

    const outward = createNodeTransport({
      jar,
      fetch: recorder(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/' },
          })
      ).fetch,
    })
    await expect(outward.fetch('https://webapi.115.com/a')).rejects.toThrow(
      '站外'
    )

    const inside = recorder(url =>
      url.endsWith('/a')
        ? new Response(null, {
            status: 303,
            headers: {
              location: '/b',
              'set-cookie': 'N=2; Domain=.115.com; Path=/',
            },
          })
        : new Response('{"ok":1}')
    )
    const transport = createNodeTransport({ jar, fetch: inside.fetch })
    await transport.useCookie('UID=1')
    const response = await transport.fetch('https://webapi.115.com/a', {
      method: 'POST',
      body: 'x',
    })
    expect(await response.json()).toEqual({ ok: 1 })
    expect(inside.sent.map(s => [s.url, s.method])).toEqual([
      ['https://webapi.115.com/a', 'POST'],
      ['https://webapi.115.com/b', 'GET'],
    ])
    expect(inside.sent[1].headers.get('cookie')).toBe('UID=1; N=2')
  })

  it('同一份登录 Cookie 再交来不重写（保留续期的值），换一份才替换', async () => {
    const jar = CookieJar.open(file)
    const transport = createNodeTransport({
      jar,
      fetch: recorder(
        () =>
          new Response('{}', {
            headers: { 'set-cookie': 'SEID=fresh; Domain=.115.com; Path=/' },
          })
      ).fetch,
    })
    await transport.useCookie('UID=1; SEID=s')
    await transport.fetch('https://webapi.115.com/files')
    // 重启：新罐子从文件读，服务 restore 再交同一份
    const reopened = CookieJar.open(file)
    await createNodeTransport({ jar: reopened }).useCookie('UID=1; SEID=s')
    expect(reopened.header('https://webapi.115.com/')).toBe('UID=1; SEID=fresh')
    await createNodeTransport({ jar: reopened }).useCookie('UID=2; SEID=t')
    expect(reopened.header('https://webapi.115.com/')).toBe('UID=2; SEID=t')
  })
})
