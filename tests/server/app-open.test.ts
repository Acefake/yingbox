/**
 * 没设访问令牌时片库服务不鉴权（默认路径）：健康检查报已授权、API / 媒体直接可用，
 * 数据目录里早期自动生成的 server.token 被忽略并删掉，带 ?token= 打开首页也只是普通页面。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'

const BASE = 'http://127.0.0.1:31480'
let work: string
let app: ServerApp
const logs: string[] = []

const call = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers)
  headers.set('host', '127.0.0.1:31480')
  return app.fetch(new Request(BASE + path, { ...init, headers }))
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-open-'))
  mkdirSync(join(work, 'data'), { recursive: true })
  mkdirSync(join(work, 'media'), { recursive: true })
  mkdirSync(join(work, 'web'), { recursive: true })
  writeFileSync(join(work, 'web/index.html'), '<div id="app"></div>')
  writeFileSync(
    join(work, 'data/secrets.json'),
    JSON.stringify({ 'server.token': 'legacy-generated-token' })
  )
  app = await createServerApp(
    {
      host: '127.0.0.1',
      port: 31480,
      dataDir: join(work, 'data'),
      cacheDir: join(work, 'data'),
      mediaRoots: [join(work, 'media')],
      webDir: join(work, 'web'),
      fetch: { kind: 'node' },
      monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
    },
    {
      fetch: (async () => new Response('', { status: 404 })) as never,
      codec: inProcessCodec(),
      watch: false,
      log: message => logs.push(message),
      env: { YINGBOX_ONLINE: 'off' },
    }
  )
})

afterAll(async () => {
  await app?.close()
  rmSync(work, { recursive: true, force: true })
})

describe('无令牌不鉴权', () => {
  it('健康检查报已授权，API 与媒体不带凭据也能用', async () => {
    expect(app.token).toBeNull()
    expect(await (await call('/api/health')).json()).toEqual({
      ok: true,
      authorized: true,
    })
    expect((await call('/api/info')).status).toBe(200)
    const rpc = await call('/api/library/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listLibraries' }),
    })
    expect(rpc.status).toBe(200)
    // 不存在的文件是 404 而不是 401：鉴权已经放行
    expect((await call('/media/files/999')).status).not.toBe(401)
  })

  it('旧的自动生成令牌既不生效也被删掉', async () => {
    const saved = JSON.parse(
      readFileSync(join(work, 'data/secrets.json'), 'utf8')
    ) as Record<string, string>
    expect(saved['server.token']).toBeUndefined()
    expect(logs.some(line => line.includes('旧访问令牌'))).toBe(true)
    const page = await call('/?token=legacy-generated-token')
    expect(page.status).toBe(200)
    expect(page.headers.get('set-cookie')).toBeNull()
  })

  it('登录接口直接成功、不写 Cookie', async () => {
    const res = await call('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'whatever' }),
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
