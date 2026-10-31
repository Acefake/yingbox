/**
 * PR #251 的预压缩与大文件流经过 node:http 适配器后字节仍然完整。
 * 视频 Range 走的是另一条路由，这里确认同一适配器不会改坏流。
 */
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { serveFile } from '../../src/main/local-media'
import { createNodeListener } from '../../src/server/http/adapter'
import {
  STATIC_STREAM_ABOVE,
  createStaticHandler,
} from '../../src/server/http/static'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

function rawGet(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, headers },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk as Buffer))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        )
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function withServer(
  handler: (request: Request) => Promise<Response>,
  run: (port: number) => Promise<void>
): Promise<void> {
  const server = createServer(createNodeListener(handler, () => {}))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run((server.address() as AddressInfo).port)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('静态流与视频 Range 经过 HTTP 适配器', () => {
  it('大于流式阈值的 brotli 文件长度与解压结果都对', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'yingbox-static-http-'))
    dirs.push(parent)
    const dir = join(parent, 'web')
    mkdirSync(join(dir, 'assets'), { recursive: true })
    const raw = randomBytes(STATIC_STREAM_ABOVE + 4096)
    const compressed = brotliCompressSync(raw)
    expect(compressed.length).toBeGreaterThanOrEqual(STATIC_STREAM_ABOVE)
    writeFileSync(join(dir, 'assets/app.js'), raw)
    writeFileSync(join(dir, 'assets/app.js.br'), compressed)
    const handler = createStaticHandler(dir)

    await withServer(
      async request => handler(request, new URL(request.url)),
      async port => {
        const res = await rawGet(port, '/assets/app.js', {
          'accept-encoding': 'br',
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-encoding']).toBe('br')
        expect(res.headers['content-length']).toBe(String(compressed.length))
        expect(res.body).toEqual(compressed)
        expect(brotliDecompressSync(res.body)).toEqual(raw)
      }
    )
  })

  it('视频 Range 与整文件经过同一适配器字节不变', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'yingbox-video-http-'))
    dirs.push(parent)
    const file = join(parent, 'clip.mkv')
    const raw = Buffer.alloc(2 * 1024 * 1024, 9)
    writeFileSync(file, raw)

    await withServer(
      request => serveFile(file, request),
      async port => {
        const part = await rawGet(port, '/media/files/1', {
          range: 'bytes=1000-1099',
        })
        expect(part.status).toBe(206)
        expect(part.headers['content-type']).toBe('video/x-matroska')
        expect(part.headers['content-range']).toBe(
          `bytes 1000-1099/${raw.length}`
        )
        expect(part.body).toEqual(Buffer.alloc(100, 9))

        const full = await rawGet(port, '/media/files/1')
        expect(full.status).toBe(200)
        expect(full.body).toEqual(raw)
      }
    )
  })
})
