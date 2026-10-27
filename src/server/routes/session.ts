/**
 * 健康检查、登录 / 退出、服务信息。
 * 登录只是把正确的令牌（YINGBOX_SERVER_TOKEN）换成 HttpOnly Cookie；没设令牌时服务不鉴权，登录直接成功。
 */
import type { ServerHealth, ServerInfo } from '../../shared/library/ipc'
import type { Auth } from '../http/auth'
import { type Router, fail, json, readJson } from '../http/router'

/** 登记会话路由。 */
export function registerSessionRoutes(
  router: Router,
  auth: Auth,
  info: () => ServerInfo
): void {
  router.add(
    'GET',
    '/api/health',
    request =>
      json({
        ok: true,
        authorized: auth.check(request),
      } satisfies ServerHealth),
    { public: true }
  )
  router.add(
    'POST',
    '/api/session',
    async request => {
      if (!auth.required) return new Response(null, { status: 204 })
      const body = (await readJson(request, 4096)) as { token?: unknown } | null
      const token = typeof body?.token === 'string' ? body.token.trim() : ''
      if (!auth.matches(token)) return fail(401, '令牌不正确')
      return new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': auth.loginCookie(request) },
      })
    },
    { public: true }
  )
  router.add(
    'DELETE',
    '/api/session',
    request =>
      new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': auth.logoutCookie(request) },
      }),
    { public: true }
  )
  router.add('GET', '/api/info', () => json(info()))
}
