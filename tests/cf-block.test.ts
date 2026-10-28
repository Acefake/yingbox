import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import {
  classifyPage,
  isBlockedPage,
  isChallengePage,
} from '../src/shared/net/cf-page'
import {
  HostUnavailableError,
  createHostBreaker,
  hostOf,
  tripLabel,
} from '../src/shared/net/host-breaker'
import { pageGetter } from '../src/engine/download/sources'

/** 真实页面：沙箱请求 4k-av 搜索页拿到的 Cloudflare 封锁页、jable 首页的挑战页（IP 已脱敏）。 */
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/cloudflare', name), 'utf-8')
const BLOCKED = fixture('blocked-4k-av.html')
const CHALLENGE = fixture('challenge-jable.html')

const net = (
  routes: Record<string, () => Response>
): ReturnType<typeof createNetClient> =>
  createNetClient({
    lookup: async () => [{ address: '93.184.216.34' }],
    fetch: async url =>
      (routes[url] ?? ((): Response => new Response('nf', { status: 404 })))(),
  })

describe('Cloudflare 页面判定', () => {
  it('真实封锁页（Sorry, you have been blocked）判为硬封锁，不算挑战', () => {
    expect(BLOCKED).toContain('Attention Required! | Cloudflare')
    expect(classifyPage(BLOCKED)).toBe('blocked')
    expect(isBlockedPage(BLOCKED)).toBe(true)
    expect(isChallengePage(BLOCKED)).toBe(false)
  })

  it('真实挑战页（Just a moment）判为可通过的挑战', () => {
    expect(classifyPage(CHALLENGE)).toBe('challenge')
    expect(isChallengePage(CHALLENGE)).toBe(true)
  })

  it.each([
    ['<span class="cf-error-code">1020</span>', 'blocked'],
    ['<title>Access denied | x used Cloudflare</title>', 'blocked'],
    ['<title>example.com | 1015: Access denied</title>', 'blocked'],
    ['<h1>Error 1006</h1>', 'blocked'],
    ['<h2>You are unable to access</h2> x.com', 'blocked'],
    ['<div id="cf-error-details">', 'blocked'],
    ['<title>Just a moment...</title>', 'challenge'],
    ['window._cf_chl_opt = {}', 'challenge'],
    ['Enable JavaScript and cookies to continue', 'challenge'],
    ['<title>Attention Required! | Cloudflare</title> captcha', 'challenge'],
    ['<p>请完成安全验证</p>', 'challenge'],
  ])('%s → %s', (html, verdict) => {
    expect(classifyPage(html)).toBe(verdict)
  })

  it('正文里出现 Access denied / blocked 等字样的正常页面不误判；非字符串算正常', () => {
    expect(classifyPage('<p>Access denied 是一部电影</p><b>blocked</b>')).toBe(
      'ok'
    )
    expect(classifyPage({ list: [] })).toBe('ok')
    expect(classifyPage('')).toBe('ok')
  })
})

describe('按主机熔断', () => {
  const clock = (): { now: () => number; tick: (ms: number) => void } => {
    let t = 1_000
    return { now: () => t, tick: ms => (t += ms) }
  }

  it('硬封锁立即熔断，冷却期内 check 返回熔断信息，到期自动恢复', () => {
    const c = clock()
    const b = createHostBreaker({ cooldownMs: 1000, now: c.now })
    const trip = b.block('https://A.test/s?q=1')
    expect(trip).toEqual({ host: 'a.test', reason: 'blocked', until: 2000 })
    expect(b.check('https://a.test/other')).toEqual(trip)
    expect(b.check('https://b.test/')).toBeNull()
    c.tick(999)
    expect(b.check('a.test')).not.toBeNull()
    c.tick(1)
    expect(b.check('a.test')).toBeNull()
  })

  it('连续失败达到阈值才熔断，成功清零计数', () => {
    const b = createHostBreaker({ threshold: 3, now: () => 0 })
    expect(b.fail('https://a.test/1')).toBeNull()
    expect(b.fail('https://a.test/2')).toBeNull()
    b.succeed('https://a.test/3')
    expect(b.fail('https://a.test/4')).toBeNull()
    expect(b.fail('https://a.test/5')).toBeNull()
    expect(b.fail('https://a.test/6', 'challenge')).toMatchObject({
      host: 'a.test',
      reason: 'challenge',
    })
    expect(b.check('a.test')).not.toBeNull()
  })

  it('默认 30 分钟冷却、3 次阈值', () => {
    const b = createHostBreaker({ now: () => 0 })
    expect(b.block('a.test').until).toBe(30 * 60 * 1000)
    b.fail('b.test')
    b.fail('b.test')
    expect(b.check('b.test')).toBeNull()
    expect(b.fail('b.test')).not.toBeNull()
  })

  it('reset 可只解除一个主机，也可全部解除（含失败计数）', () => {
    const b = createHostBreaker({ threshold: 2, now: () => 0 })
    b.block('a.test')
    b.block('b.test')
    b.fail('c.test')
    b.reset('https://a.test/x')
    expect(b.check('a.test')).toBeNull()
    expect(b.check('b.test')).not.toBeNull()
    b.reset()
    expect(b.check('b.test')).toBeNull()
    expect(b.fail('c.test')).toBeNull()
  })

  it('hostOf 兼容 URL 与主机名；错误信息写明原因', () => {
    expect(hostOf('https://WWW.X.test:8443/a')).toBe('www.x.test')
    expect(hostOf(' X.test ')).toBe('x.test')
    const error = new HostUnavailableError({
      host: 'x.test',
      reason: 'blocked',
      until: 0,
    })
    expect(error.message).toBe('x.test 暂不可用（被站点拦截）')
    expect(tripLabel('challenge')).toBe('站点验证未通过')
    expect(tripLabel('unreachable')).toBe('无法访问')
    expect(tripLabel('plugin')).toBe('插件脚本下载失败')
  })
})

describe('下载源遇到硬封锁不找浏览器', () => {
  it('下载源页面获取：封锁页返回 undefined 不开浏览器，挑战页仍交给浏览器', async () => {
    const browserFetch = vi.fn(async () => '<html>ok</html>')
    const get = pageGetter({
      net: net({
        'https://a.test/blocked': () => new Response(BLOCKED, { status: 403 }),
        'https://a.test/cf': () => new Response(CHALLENGE, { status: 403 }),
      }),
      browserFetch,
    })
    expect(await get('https://a.test/blocked')).toBeUndefined()
    expect(browserFetch).not.toHaveBeenCalled()
    expect(await get('https://a.test/cf')).toBe('<html>ok</html>')
    expect(browserFetch).toHaveBeenCalledWith('https://a.test/cf')
  })
})
