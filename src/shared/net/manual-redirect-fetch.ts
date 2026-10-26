/**
 * 给 shared/net/client 用的「手动重定向」fetch：Electron 37 的 net.fetch 遇到 `redirect: 'manual'`
 * 不返回 3xx 响应，而是直接抛 `Redirect was cancelled`（Electron 实测），于是任何 302 的地址都走不通——
 * IPTV 源、CMS 接口的 http→https 跳转、HLS 清单 / 分片的 302 调度都属于这种情况。
 *
 * manual 模式交给 net.request（同一个 Chromium 网络栈、同一会话与系统代理）：收到重定向时把状态码和
 * Location 包成一个空响应交回去、取消原请求，由 client 逐跳做 SSRF 校验后再请求下一跳；其余模式交给 net.fetch。
 *
 * 主进程（播放代理、线路探测）与后台引擎 utilityProcess 共用，所以放在 shared：这里只引用 electron 的类型，
 * net.request / net.fetch 由调用方注入，不能出现 app / session 等只在主进程可用的 API。
 */
import type {
  ClientRequest,
  ClientRequestConstructorOptions,
  IncomingMessage,
} from 'electron'

import type { FetchImpl } from './client'

/** net.request 的形状（测试注入假实现） */
export type RequestFactory = (
  options: ClientRequestConstructorOptions
) => ClientRequest

/** 不能带响应体的状态码 */
const NULL_BODY = new Set([101, 103, 204, 205, 304])

/** IncomingMessage 的响应头 → Headers（多值逐个追加） */
function toHeaders(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw))
    for (const v of Array.isArray(value) ? value : [value])
      if (v !== undefined) headers.append(name, String(v))
  return headers
}

/** 运行时 IncomingMessage 是 Node Readable（类型声明里没写 pause / resume / close 事件） */
type Pausable = { pause(): void; resume(): void }
type Closable = { on(event: 'close', listener: () => void): void }

/**
 * IncomingMessage → WHATWG ReadableStream（带背压；取消时中止请求）。
 *
 * Electron 37 的 ClientRequest.abort()（外部 signal 取消、超时）只对响应 destroy()：只发 close，
 * 不发 end / error / aborted。不接 close 的话读响应体的一方会一直等下去（超时形同虚设），
 * 所以没正常结束就收到 close 时按「连接中断」报错。流结束或被取消后不再碰 controller（会抛 Invalid state）。
 */
function toStream(
  res: IncomingMessage,
  request: ClientRequest
): ReadableStream<Uint8Array> {
  let finished = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (error?: Error): void => {
        if (finished) return
        finished = true
        if (error) controller.error(error)
        else controller.close()
      }
      res.on('data', (chunk: Buffer) => {
        if (finished) return
        controller.enqueue(new Uint8Array(chunk))
        if ((controller.desiredSize ?? 1) <= 0)
          (res as unknown as Pausable).pause()
      })
      res.on('end', () => finish())
      res.on('error', (error: Error) => finish(error))
      res.on('aborted', () => finish(new Error('连接中断')))
      ;(res as unknown as Closable).on('close', () =>
        finish(new Error('连接中断'))
      )
    },
    pull() {
      ;(res as unknown as Pausable).resume()
    },
    cancel() {
      finished = true
      request.abort()
    },
  })
}

/** manualRedirectFetch 的选项 */
export interface ManualRedirectOptions {
  /**
   * 凭据模式，默认 `omit`：播放代理、线路探测不带会话 Cookie。
   * 后台引擎传 `include`：同时打开 `useSessionCookies`，请求带上默认会话的 Cookie
   * （CF 挑战放行后的 cf_clearance、先 Set-Cookie 再校验的接口），响应里的 Set-Cookie 也写回会话，
   * 与 net.fetch 的 Cookie 行为一致。
   */
  credentials?: 'include' | 'omit'
}

/** 编码后的请求体：字节与它自带的 Content-Type（FormData 的 boundary、URLSearchParams 的表单类型） */
interface EncodedBody {
  bytes: Buffer
  contentType: string | null
}

/**
 * 把 string 以外的 BodyInit（URLSearchParams、FormData、Blob、ArrayBuffer、TypedArray、ReadableStream）
 * 按 fetch 规范编码成字节，ClientRequest 只能写 string / Buffer。
 */
async function encodeBody(body: BodyInit): Promise<EncodedBody> {
  const encoded = new Response(body)
  return {
    bytes: Buffer.from(await encoded.arrayBuffer()),
    contentType: encoded.headers.get('content-type'),
  }
}

/**
 * 包一层：`redirect: 'manual'` 走 net.request，其余交给 fallback（net.fetch）。
 * 请求体支持 fetch 的全部 BodyInit：string 直接写，其余先编码成字节（缺 Content-Type 时补上编码得到的类型）。
 * @param request net.request
 * @param fallback net.fetch
 * @param options 凭据模式等，见 ManualRedirectOptions
 */
export function manualRedirectFetch(
  request: RequestFactory,
  fallback: FetchImpl,
  options: ManualRedirectOptions = {}
): FetchImpl {
  const credentials = options.credentials ?? 'omit'
  const send = (
    url: string,
    init: RequestInit,
    body?: string | EncodedBody
  ): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
        return
      }
      const headers = new Headers(init.headers)
      const req = request({
        url,
        method: init.method ?? 'GET',
        redirect: 'manual',
        credentials,
        useSessionCookies: credentials === 'include',
        // 手写的 Referer 要配 unsafe-url，否则 Chromium 按默认引用策略把请求取消（见 shared/net/referrer.ts）
        ...(headers.has('referer') ? { referrerPolicy: 'unsafe-url' } : {}),
      })
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
      const onAbort = (): void => {
        req.abort()
        fail(signal?.reason ?? new DOMException('aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (
        typeof body === 'object' &&
        body.contentType &&
        !headers.has('content-type')
      )
        headers.set('content-type', body.contentType)
      headers.forEach((value, name) => req.setHeader(name, value))

      req.on('redirect', (status, _method, location) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        req.abort()
        resolve(new Response(null, { status, headers: { location } }))
      })
      req.on('response', res => {
        if (settled) return
        settled = true
        // 响应体读取期间的取消由流的 cancel / 上层 signal 负责
        signal?.removeEventListener('abort', onAbort)
        signal?.addEventListener('abort', () => req.abort(), { once: true })
        const status = res.statusCode
        resolve(
          new Response(NULL_BODY.has(status) ? null : toStream(res, req), {
            status,
            statusText: res.statusMessage,
            headers: toHeaders(res.headers),
          })
        )
      })
      req.on('error', fail)
      req.on('abort', () => fail(new DOMException('aborted', 'AbortError')))
      if (typeof body === 'string') req.write(body)
      else if (body) req.write(body.bytes)
      req.end()
    })

  return (url, init) => {
    if (init.redirect !== 'manual') return fallback(url, init)
    const body = init.body
    if (body === undefined || body === null || typeof body === 'string')
      return send(url, init, body ?? undefined)
    return encodeBody(body).then(encoded => send(url, init, encoded))
  }
}
