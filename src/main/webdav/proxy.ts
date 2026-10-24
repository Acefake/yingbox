/**
 * 远程媒体播放代理：播放器只看到本地地址，凭据由主进程加在转发给 NAS / Alist 的请求上。
 *
 * - 内置播放器：<video src="yingbox-dav://<源 id>/<编码路径>">，由 protocol.handle 交给 handleRemoteMedia；
 * - mpv：本机 HTTP 代理 http://127.0.0.1:<端口>/<令牌>/<源 id>/<编码路径>（只听回环地址，
 *   随机令牌防止本机其他程序借道读 NAS），按需启动、退出时关闭。
 * 两条路都支持 Range（拖进度条），转发规则见 shared/webdav/proxy-rules。
 * Alist 的 302 直链：fetch 跟随跳转，跨域跳转时按 fetch 规范丢掉 Authorization，直链本身带签名。
 */
import { randomBytes } from 'node:crypto'
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import {
  type DavAccess,
  type DavFetch,
  authHeader,
  davUrl,
} from '../../shared/webdav/client'
import {
  PROXY_METHODS,
  downstreamHeaders,
  proxyStatus,
  upstreamHeaders,
} from '../../shared/webdav/proxy-rules'
import {
  REMOTE_SCHEME,
  SOURCE_ID_RE,
  encodeRemotePath,
  parseRemoteMediaUrl,
  parseRemotePath,
} from '../../shared/webdav/remote-path'

/** 按扩展名猜的视频类型（上游给 application/octet-stream 时用）。 */
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
}

/** 按源 id 取连接信息。 */
export type AccessLookup = (sourceId: string) => Promise<DavAccess | null>

/** 一次播放请求的最小形状（Fetch Request 与 Node IncomingMessage 都能适配）。 */
interface ProxyRequest {
  method: string
  header: (name: string) => string | null | undefined
  signal?: AbortSignal
}

/** 把一次播放请求转发到远程源，返回给播放器的响应。 */
export async function forwardRemote(
  request: ProxyRequest,
  target: { sourceId: string; path: string },
  lookup: AccessLookup,
  fetch: DavFetch
): Promise<Response> {
  if (!PROXY_METHODS.has(request.method))
    return new Response(null, { status: 405 })
  const access = await lookup(target.sourceId)
  if (!access) return new Response(null, { status: 404 })
  let upstream: Response
  try {
    upstream = await fetch(davUrl(access.url, target.path), {
      method: request.method,
      headers: upstreamHeaders(request.header, authHeader(access)),
      redirect: 'follow',
      signal: request.signal,
    })
  } catch {
    return new Response(null, { status: 502 })
  }
  const status = proxyStatus(upstream.status)
  if (status === 502 || status === 404) {
    await upstream.body?.cancel()
    return new Response(null, { status })
  }
  const headers = downstreamHeaders(
    name => upstream.headers.get(name),
    MIME[extname(target.path).toLowerCase()]
  )
  const body =
    request.method === 'HEAD' || status === 304 ? null : upstream.body
  if (!body) await upstream.body?.cancel()
  return new Response(body, { status, headers })
}

/** yingbox-dav 协议处理器（内置播放器）。 */
export function createRemoteMediaHandler(
  lookup: AccessLookup,
  fetch: DavFetch
): (request: Request) => Promise<Response> {
  return async request => {
    const target = parseRemoteMediaUrl(request.url)
    if (!target) return new Response(null, { status: 400 })
    return forwardRemote(
      {
        method: request.method,
        header: name => request.headers.get(name),
        signal: request.signal,
      },
      target,
      lookup,
      fetch
    )
  }
}

/** mpv 用的本机代理。 */
export interface MpvProxy {
  /** 库里的远程路径 → 代理地址；不是远程路径返回 null。首次调用时启动代理。 */
  urlFor(path: string): Promise<string | null>
  close(): Promise<void>
}

/** 代理地址的路径 → 源 id 与解码后的远程路径；令牌不对返回 null。 */
export function parseProxyPath(
  pathname: string,
  token: string
): { sourceId: string; path: string } | null {
  const prefix = `/${token}/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const slash = rest.indexOf('/')
  const sourceId = slash < 0 ? rest : rest.slice(0, slash)
  if (!SOURCE_ID_RE.test(sourceId)) return null
  return parseRemoteMediaUrl(
    `${REMOTE_SCHEME}://${sourceId}${slash < 0 ? '/' : rest.slice(slash)}`
  )
}

/** 建 mpv 代理（按需监听 127.0.0.1 的随机端口）。 */
export function createMpvProxy(
  lookup: AccessLookup,
  fetch: DavFetch
): MpvProxy {
  const token = randomBytes(16).toString('hex')
  let server: Server | null = null
  let listening: Promise<number> | null = null

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    const pathname = (req.url ?? '/').replace(/\?.*$/, '')
    const target = parseProxyPath(pathname, token)
    if (!target) {
      res.writeHead(404).end()
      return
    }
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    const response = await forwardRemote(
      {
        method: req.method ?? 'GET',
        header: name => {
          const value = req.headers[name]
          return Array.isArray(value) ? value[0] : value
        },
        signal: abort.signal,
      },
      target,
      lookup,
      fetch
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body) {
      res.end()
      return
    }
    Readable.fromWeb(response.body as NodeReadableStream)
      .on('error', () => res.destroy())
      .pipe(res)
  }

  const start = (): Promise<number> => {
    listening ??= new Promise((resolve, reject) => {
      server = createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(502)
          res.end()
        })
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () =>
        resolve((server!.address() as AddressInfo).port)
      )
    })
    return listening
  }

  return {
    async urlFor(path) {
      const parsed = parseRemotePath(path)
      if (!parsed) return null
      const port = await start()
      return `http://127.0.0.1:${port}/${token}/${parsed.sourceId}${encodeRemotePath(parsed.path)}`
    },
    close: () =>
      new Promise(resolve => {
        if (!server) return resolve()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
