/**
 * 独立服务测试的公共夹具：临时目录 + createServerApp（不占端口，直接调 app.fetch）+ 带令牌的请求 / RPC。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HttpFetch } from '../../src/main/library/identify/identify-module'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'
import type { ServerConfig } from '../../src/server/config'
import type { InvokeResult } from '../../src/shared/library/ipc'

export const TOKEN = 'test-token-abcdefghijklmnop'
const BASE = 'http://127.0.0.1:31480'

/** 一个跑起来的测试服务。 */
export interface Harness {
  app: ServerApp
  work: string
  media: string
  /** 在媒体目录里写文件（内容为字符串或字节数）。 */
  write(path: string, content: string | Buffer | number): string
  call(path: string, init?: RequestInit & { auth?: boolean }): Promise<Response>
  rpc(method: string, params?: unknown): Promise<InvokeResult>
  /** 调 RPC，失败时抛错，返回结果。 */
  ok<T>(method: string, params?: unknown): Promise<T>
  close(): Promise<void>
}

/** 起一个服务：files 先写进媒体目录，env 补进服务环境变量。 */
export async function startServer(options: {
  fetch: HttpFetch
  env?: NodeJS.ProcessEnv
  files?: Record<string, string | Buffer | number>
}): Promise<Harness> {
  const work = mkdtempSync(join(tmpdir(), 'yingbox-server-'))
  const media = join(work, 'media')
  mkdirSync(media, { recursive: true })
  const write = (path: string, content: string | Buffer | number): string => {
    const full = join(media, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(
      full,
      typeof content === 'number' ? Buffer.alloc(content, 7) : content
    )
    return full
  }
  for (const [path, content] of Object.entries(options.files ?? {}))
    write(path, content)
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 31480,
    dataDir: join(work, 'data'),
    cacheDir: join(work, 'cache'),
    mediaRoots: [media],
    webDir: null,
    fetch: { kind: 'node' },
    monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
  }
  const app = await createServerApp(config, {
    fetch: options.fetch,
    codec: inProcessCodec(),
    watch: false,
    log: () => {},
    env: { YINGBOX_SERVER_TOKEN: TOKEN, ...options.env },
  })
  const call = (
    path: string,
    init: RequestInit & { auth?: boolean } = {}
  ): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('host', '127.0.0.1:31480')
    if (init.auth !== false) headers.set('authorization', `Bearer ${TOKEN}`)
    return app.fetch(new Request(BASE + path, { ...init, headers }))
  }
  const rpc = async (method: string, params?: unknown): Promise<InvokeResult> =>
    (await (
      await call('/api/library/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
    ).json()) as InvokeResult
  return {
    app,
    work,
    media,
    write,
    call,
    rpc,
    async ok<T>(method: string, params?: unknown): Promise<T> {
      const result = await rpc(method, params)
      if (!result.ok) throw new Error(`${method}: ${result.error.message}`)
      return result.result as T
    },
    async close() {
      await app.close()
      rmSync(work, { recursive: true, force: true })
    },
  }
}
