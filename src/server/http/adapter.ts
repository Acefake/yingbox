/**
 * node:http ↔ Web Request / Response：服务内部所有处理函数都是 `(Request) => Promise<Response>`，
 * 与缩略图协议处理（thumbnails/protocol.ts）、文件流（local-media.ts）同一种形状，也便于不起端口直接单测。
 *
 * 客户端断开时中止 request.signal，并取消响应体流（SSE 据此退订、视频流据此关文件）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

/** 处理函数。 */
export type Handler = (request: Request) => Promise<Response>

/** 把 Node 请求转成 Web Request。 */
export function toWebRequest(
  req: IncomingMessage,
  signal: AbortSignal
): Request {
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`
  )
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value])
      headers.append(name, item)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    signal,
    ...(hasBody
      ? {
          body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
          duplex: 'half',
        }
      : {}),
  } as RequestInit)
}

/** 把 Web Response 写回 Node 响应。 */
export async function sendWebResponse(
  res: ServerResponse,
  response: Response
): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  if (!response.body) {
    res.end()
    return
  }
  const body = Readable.fromWeb(response.body as never)
  res.on('close', () => body.destroy())
  body.on('error', () => res.destroy())
  body.pipe(res)
}

/** 包成 http.createServer 的监听函数；处理函数抛错时回 500。 */
export function createNodeListener(
  handler: Handler,
  log: (message: string) => void
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    void (async () => {
      let response: Response
      try {
        response = await handler(toWebRequest(req, controller.signal))
      } catch (error) {
        log(`处理 ${req.method} ${req.url} 出错：${(error as Error).message}`)
        response = new Response('Internal Server Error', { status: 500 })
      }
      await sendWebResponse(res, response)
    })()
  }
}
