/**
 * 容器健康检查 docker/healthcheck.mjs：按 YINGBOX_HOST / YINGBOX_PORT 请求 /api/health，
 * 200 且 { ok: true } 退出 0，其余（非 200、ok 不是 true、连不上）退出 1。
 * 监听 0.0.0.0 / :: 时改连本机回环地址。用真的 HTTP 服务。
 */
import { spawn } from 'node:child_process'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../docker/healthcheck.mjs')

let server: Server | null = null
let hits: string[] = []

afterEach(async () => {
  await new Promise<void>(done =>
    server ? server.close(() => done()) : done()
  )
  server = null
  hits = []
})

/** 起一个只回答 /api/health 的服务，返回端口。 */
async function serve(status: number, body: string): Promise<number> {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    res.writeHead(req.url === '/api/health' ? status : 404, {
      'content-type': 'application/json',
    })
    res.end(body)
  })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  return (server.address() as AddressInfo).port
}

/** 跑健康检查脚本（异步，不阻塞本进程里的 HTTP 服务）。 */
function check(env: Record<string, string>): Promise<number | null> {
  return new Promise(done => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: 'ignore',
    })
    child.on('exit', code => done(code))
  })
}

describe('健康检查', () => {
  it('200 + ok:true → 0；监听 0.0.0.0 时连 127.0.0.1', async () => {
    const port = await serve(200, '{"ok":true}')
    expect(
      await check({ YINGBOX_HOST: '0.0.0.0', YINGBOX_PORT: String(port) })
    ).toBe(0)
    expect(hits).toEqual(['/api/health'])
  })

  it('不设 YINGBOX_HOST 时连 127.0.0.1', async () => {
    const port = await serve(200, '{"ok":true}')
    expect(await check({ YINGBOX_PORT: String(port) })).toBe(0)
  })

  it('非 200 → 1', async () => {
    const port = await serve(503, '{"ok":true}')
    expect(await check({ YINGBOX_PORT: String(port) })).toBe(1)
  })

  it('ok 不是 true 或不是 JSON → 1', async () => {
    const port = await serve(200, '{"ok":false}')
    expect(await check({ YINGBOX_PORT: String(port) })).toBe(1)
    server!.removeAllListeners('request')
    server!.on('request', (_req, res) => res.end('<html>'))
    expect(await check({ YINGBOX_PORT: String(port) })).toBe(1)
  })

  it('连不上 → 1', async () => {
    const port = await serve(200, '{"ok":true}')
    await new Promise<void>(done => server!.close(() => done()))
    server = null
    expect(await check({ YINGBOX_PORT: String(port) })).toBe(1)
  })
})
