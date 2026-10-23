import { describe, expect, it } from 'vitest'
import { createAuth, sameOrigin } from '../../src/server/http/auth'
import { loadConfig, parsePublicOrigin } from '../../src/server/config'
import { Router } from '../../src/server/http/router'
import { registerSessionRoutes } from '../../src/server/routes/session'

const request = (
  origin?: string,
  extra: Record<string, string> = {}
): Request =>
  new Request('http://nas:31480/api/session', {
    method: 'POST',
    headers: { host: 'nas:31480', ...(origin ? { origin } : {}), ...extra },
  })

describe('HTTPS 会话', () => {
  it('直连 HTTPS 与显式配置的 HTTPS 反向代理都写 Secure，登录和退出属性一致', () => {
    const direct = createAuth('token')
    const https = new Request('https://media.test/api/session')
    expect(direct.loginCookie(https)).toContain('; Secure')
    expect(direct.logoutCookie(https)).toContain('; Secure')
    const proxy = createAuth('token', 'https://media.test')
    expect(proxy.loginCookie(request())).toContain('; Secure')
    expect(proxy.logoutCookie(request())).toContain('; Secure')
    expect(direct.loginCookie(request())).not.toContain('; Secure')
  })
  it('真实会话路由的登录与退出使用 HTTPS 公网配置', async () => {
    const router = new Router()
    registerSessionRoutes(
      router,
      createAuth('secret', 'https://media.test'),
      () => ({ mediaRoots: [], fetch: 'node' })
    )
    for (const method of ['POST', 'DELETE']) {
      const req = new Request('http://backend/api/session', {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST'
          ? { body: JSON.stringify({ token: 'secret' }) }
          : {}),
      })
      const route = router.match(method, '/api/session')
      if (!route || typeof route === 'string') throw new Error('缺少会话路由')
      const response = await route.handler(req, {
        url: new URL(req.url),
        params: {},
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('set-cookie')).toContain('; Secure')
      expect(response.headers.get('set-cookie')).toContain(
        method === 'POST' ? 'Max-Age=31536000' : 'Max-Age=0'
      )
    }
  })

  it('不信任客户端伪造的转发头，同源比较包含协议和端口', () => {
    const spoof = request('https://nas:31480', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'evil.test',
    })
    expect(sameOrigin(spoof)).toBe(false)
    expect(createAuth('token').loginCookie(spoof)).not.toContain('; Secure')
    expect(sameOrigin(request('http://nas:31480'))).toBe(true)
    expect(sameOrigin(request('http://nas'))).toBe(false)
    expect(
      sameOrigin(request('https://media.test'), 'https://media.test')
    ).toBe(true)
    expect(sameOrigin(request('http://media.test'), 'https://media.test')).toBe(
      false
    )
    expect(sameOrigin(request('null'), 'https://media.test')).toBe(false)
  })
  it('配置源校验、CLI 优先级以及本地 HTTP 默认值', () => {
    expect(parsePublicOrigin(undefined)).toBeUndefined()
    expect(parsePublicOrigin('https://media.test:443/')).toBe(
      'https://media.test'
    )
    for (const bad of [
      'file:///tmp/a',
      'https://user:pass@media.test',
      'https://media.test/path',
      'https://media.test/?x=1',
    ])
      expect(() => parsePublicOrigin(bad)).toThrow()
    expect(
      loadConfig(['--public-origin=https://cli.test'], {
        YINGBOX_PUBLIC_ORIGIN: 'https://env.test',
      }).publicOrigin
    ).toBe('https://cli.test')
    expect(loadConfig([], {}).publicOrigin).toBeUndefined()
  })
})
