import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'
import { createAuth, sameOrigin } from '../../src/server/http/auth'
import { registerServerFeatures } from '../../src/server/nas/features'

const LOCAL = 'http://nas:31480'
const REMOTE = 'https://app-31480-example.cn68.ugdocker.link'
const TOKEN = 'dual-origin-test-token-abcdefghijklmnop'
let work: string
let app: ServerApp

function request(
  origin: string,
  path = '/api/session',
  method = 'POST'
): Request {
  return new Request(LOCAL + path, {
    method,
    headers: { host: 'nas:31480', origin, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ token: TOKEN }) } : {}),
  })
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-dual-origin-'))
  mkdirSync(join(work, 'media'))
  mkdirSync(join(work, 'web'))
  writeFileSync(join(work, 'web/index.html'), '<div id="app">影盒 NAS</div>')
  app = await createServerApp(
    {
      host: '127.0.0.1',
      port: 31480,
      publicOrigin: REMOTE,
      dataDir: join(work, 'data'),
      cacheDir: join(work, 'cache'),
      mediaRoots: [join(work, 'media')],
      webDir: join(work, 'web'),
      fetch: { kind: 'node' },
      monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
    },
    {
      codec: inProcessCodec(),
      watch: false,
      log: () => {},
      env: { YINGBOX_SERVER_TOKEN: TOKEN, YINGBOX_NETDISK: 'off' },
      features: registerServerFeatures,
    }
  )
})

afterAll(async () => {
  await app?.close()
  if (work) rmSync(work, { recursive: true, force: true })
})

describe('内网与绿联远程入口', () => {
  it('没有配置访问令牌时仍保持免登录', () => {
    const auth = createAuth(null, REMOTE)
    expect(auth.required).toBe(false)
    expect(auth.check(request(LOCAL))).toBe(true)
    expect(auth.check(request(REMOTE))).toBe(true)
  })

  it('配置远程入口后，内网与远程来源同时通过，其他来源仍被拒绝', () => {
    expect(sameOrigin(request(LOCAL), REMOTE)).toBe(true)
    expect(sameOrigin(request(REMOTE), REMOTE)).toBe(true)
    for (const bad of [
      'https://evil.test',
      'http://nas',
      'https://nas:31480',
      'null',
    ])
      expect(sameOrigin(request(bad), REMOTE)).toBe(false)
    const spoof = request('https://evil.test')
    spoof.headers.set('x-forwarded-host', new URL(REMOTE).host)
    spoof.headers.set('x-forwarded-proto', 'https')
    expect(sameOrigin(spoof, REMOTE)).toBe(false)
  })

  it('Cookie 按已校验入口设置 Secure，登录与退出保持一致', () => {
    const auth = createAuth(TOKEN, REMOTE)
    for (const make of [auth.loginCookie, auth.logoutCookie]) {
      expect(make(request(REMOTE))).toContain('; Secure')
      expect(make(request(LOCAL))).not.toContain('; Secure')
      expect(make(request(LOCAL))).toContain('; HttpOnly; SameSite=Strict')
    }
  })

  it.each([LOCAL, REMOTE])(
    '通过 %s 登录后可用 Cookie 查询片库并退出',
    async origin => {
      const login = await app.fetch(request(origin))
      expect(login.status).toBe(204)
      const cookie = login.headers.get('set-cookie')?.split(';')[0]
      expect(cookie).toBeTruthy()
      const rpc = new Request(`${LOCAL}/api/library/rpc`, {
        method: 'POST',
        headers: {
          host: 'nas:31480',
          origin,
          cookie: cookie!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ method: 'listLibraries' }),
      })
      expect((await app.fetch(rpc)).status).toBe(200)
      const logout = await app.fetch(request(origin, '/api/session', 'DELETE'))
      expect(logout.status).toBe(204)
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(logout.headers.get('set-cookie')?.includes('; Secure')).toBe(
        origin === REMOTE
      )
    }
  )

  it('拒绝第三方来源登录', async () => {
    expect((await app.fetch(request('https://evil.test'))).status).toBe(403)
  })

  it('令牌链接经网页同源登录，避免在 GET 上猜测代理前的协议', async () => {
    const response = await app.fetch(new Request(`${LOCAL}/?token=${TOKEN}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).toContain('影盒 NAS')
  })
})
