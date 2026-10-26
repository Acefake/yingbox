/**
 * 服务端设置的 HTTP 路由：GET 快照、POST 写一个键（线格式见 shared/settings/server-keys.ts）。
 */
import { SERVER_SETTINGS_HTTP } from '../../shared/settings/server-keys'
import { HttpError, type Router, json, readJson } from '../http/router'
import { type ServerSettingsStore, SettingRejected } from '.'

/** 登记服务端设置路由 */
export function registerServerSettingsRoutes(
  router: Router,
  store: ServerSettingsStore
): void {
  router.add('GET', SERVER_SETTINGS_HTTP, () => json(store.snapshot()))
  router.add('POST', SERVER_SETTINGS_HTTP, async request => {
    const body = (await readJson(request)) as {
      key?: unknown
      value?: unknown
    } | null
    if (!body || typeof body.key !== 'string')
      throw new HttpError(400, '请求体应为 { key, value }')
    try {
      return json({ ok: true, value: store.set(body.key, body.value) })
    } catch (error) {
      if (error instanceof SettingRejected)
        throw new HttpError(400, error.message)
      throw error
    }
  })
}
