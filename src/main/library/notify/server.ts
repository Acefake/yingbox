/**
 * 外部变更通知的 HTTP 端点（node:http，不依赖 Electron，单测直接起）。
 *
 * - 只认 POST {@link NOTIFY_PATH}；其他路径 404、其他方法 405；
 * - 令牌：查询参数 ?token=…（CloudDrive2 的 url 里直接带上），或请求头 Authorization: Bearer …；
 *   不对 401（定长比较，不泄露长度以外的信息）；
 * - 请求体 JSON、上限 1 MiB（超了 413），格式见 payload.ts（不对 400）；
 * - 交给 onChanges（转给媒体库引擎），回 200 { accepted, ignored }；引擎不可用 503。
 * 默认只监听 127.0.0.1，由调用方决定是否开放局域网。
 */
import { timingSafeEqual } from 'node:crypto'
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  FileChangeNotice,
  NotifyChangesResult,
} from '../../../shared/library/ipc'
import { NotifyPayloadError, parseNotifyPayload } from './payload'

/** 端点路径。 */
export const NOTIFY_PATH = '/library/notify'
/** 请求体上限。 */
export const NOTIFY_MAX_BODY = 1024 * 1024

/** 启动参数。 */
export interface NotifyServerOptions {
  host: string
  /** 0 表示让系统挑一个空闲端口 */
  port: number
  token: string
  onChanges: (changes: FileChangeNotice[]) => Promise<NotifyChangesResult>
}

/** 正在监听的端点。 */
export interface NotifyServer {
  readonly port: number
  close(): Promise<void>
}

/** 定长比较令牌。 */
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 请求里带的令牌：?token= 优先，其次 Authorization: Bearer。 */
function tokenOf(req: IncomingMessage, url: URL): string {
  const query = url.searchParams.get('token')
  if (query) return query
  const auth = req.headers.authorization ?? ''
  return /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? ''
}

/** 读完请求体；超过上限时返回 null。 */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > NOTIFY_MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function handle(
  options: NotifyServerOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== NOTIFY_PATH)
    return reply(res, 404, { error: '没有这个地址' })
  if (req.method !== 'POST') return reply(res, 405, { error: '只接受 POST' })
  if (!sameToken(tokenOf(req, url), options.token))
    return reply(res, 401, { error: '令牌不对' })
  const text = await readBody(req)
  if (text === null) return reply(res, 413, { error: '请求体太大' })
  let changes: FileChangeNotice[]
  try {
    changes = parseNotifyPayload(JSON.parse(text))
  } catch (error) {
    const message =
      error instanceof NotifyPayloadError ? error.message : '请求体不是 JSON'
    return reply(res, 400, { error: message })
  }
  if (!changes.length) return reply(res, 200, { accepted: 0, ignored: 0 })
  try {
    reply(res, 200, await options.onChanges(changes))
  } catch (error) {
    reply(res, 503, { error: (error as Error).message })
  }
}

/** 启动端点；端口被占用等错误直接 reject（error.code 保留）。 */
export function startNotifyServer(
  options: NotifyServerOptions
): Promise<NotifyServer> {
  const server = createServer((req, res) => {
    handle(options, req, res).catch(error => {
      if (!res.headersSent) reply(res, 500, { error: String(error) })
      else res.end()
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise(done => {
            server.close(() => done())
            server.closeAllConnections()
          }),
      })
    })
  })
}
