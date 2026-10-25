/**
 * 115 传输层的纯逻辑：只给 115 域补 Referer / UA、Cookie 串拆成分区 Cookie 的写入参数。
 * Electron 分区本身由 scripts/pan115-selftest.mjs 在真 Electron 里对回显服务器验证。
 */
import { describe, expect, it } from 'vitest'

import { USER_AGENT } from '../../src/main/pan115/http'
import {
  PAN115_REFERER,
  PAN115_URL_PATTERNS,
  cookieDetails,
  is115Url,
  parseCookieHeader,
  with115Headers,
} from '../../src/main/pan115/transport'

describe('115 传输层', () => {
  it('is115Url：115.com 及其子域，别的域名（含仿冒）都不算', () => {
    expect(is115Url('https://115.com/')).toBe(true)
    expect(is115Url('https://webapi.115.com/files?cid=0')).toBe(true)
    expect(is115Url('https://passportapi.115.com/app/1.0/x')).toBe(true)
    expect(is115Url('https://evil115.com/')).toBe(false)
    expect(is115Url('https://115.com.evil.net/')).toBe(false)
    expect(is115Url('not a url')).toBe(false)
  })

  it('过滤规则覆盖主域与子域', () => {
    expect(PAN115_URL_PATTERNS).toEqual(['*://115.com/*', '*://*.115.com/*'])
  })

  it('with115Headers：115 域覆盖 Referer 与 UA（不论原来的大小写），其余头保留', () => {
    const out = with115Headers('https://webapi.115.com/files', {
      'user-agent': 'Electron/37',
      referer: 'about:blank',
      Accept: '*/*',
    })
    expect(out).toEqual({
      Accept: '*/*',
      Referer: PAN115_REFERER,
      'User-Agent': USER_AGENT,
    })
  })

  it('with115Headers：别的域名原样返回，不带 115 的 Referer', () => {
    const headers = { 'User-Agent': 'Electron/37' }
    expect(with115Headers('https://so.example.com/api/search', headers)).toBe(
      headers
    )
  })

  it('parseCookieHeader：拆出 UID / CID / SEID / KID，跳过空段与无名段', () => {
    expect(
      parseCookieHeader('UID=10086_A1_1; CID=cid-x;SEID=a=b; ; =x; KID=kid-x')
    ).toEqual([
      { name: 'UID', value: '10086_A1_1' },
      { name: 'CID', value: 'cid-x' },
      { name: 'SEID', value: 'a=b' },
      { name: 'KID', value: 'kid-x' },
    ])
  })

  it('cookieDetails：写在 .115.com、路径 /、HttpOnly；https 时带 Secure，不设过期（只在内存）', () => {
    const [uid] = cookieDetails('UID=1; SEID=2', 'https://115.com')
    expect(uid).toEqual({
      url: 'https://115.com',
      domain: '.115.com',
      path: '/',
      name: 'UID',
      value: '1',
      secure: true,
      httpOnly: true,
    })
    expect(cookieDetails('UID=1', 'http://115.com')[0].secure).toBe(false)
    expect(cookieDetails('', 'https://115.com')).toEqual([])
  })
})
