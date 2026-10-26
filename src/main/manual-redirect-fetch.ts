/**
 * 给 shared/net/client 用的「手动重定向」fetch：Electron 37 的 net.fetch 遇到 `redirect: 'manual'`
 * 不返回 3xx 响应，而是直接抛 `Redirect was cancelled`（Electron 实测），于是任何 302 的地址都走不通——
 * IPTV 源大量是 302 跳转（gslb 调度、php 接口、运营商 PLTV 节点）。
 *
 * 这里改用 net.request（同一个 Chromium 网络栈、同一会话与系统代理）：收到重定向时把状态码和 Location
 * 包成一个空响应交回去、取消原请求，由 client 逐跳做 SSRF 校验后再请求下一跳；其余模式仍交给 net.fetch。
 */
import type {
  ClientRequest,
  ClientRequestConstructorOptions,
  IncomingMessage,
} from 'electron'

import type { FetchImpl } from '../shared/net/client'

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

/** 运行时 IncomingMessage 是 Node Readable（类型声明里没写 pause / resume） */
type Pausable = { pause(): void; resume(): void }

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
      res.on('close', () => finish(new Error('连接中断')))
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
   * 凭据模式，默认 omit（播放代理、线路探测不带会话 Cookie）。
   * 后台引擎传 include，与它原先的 net.fetch 一致（无 Origin 时 net.fetch 按 include 发）。
   */
  credentials?: 'include' | 'omit'
}

/**
 * 包一层：`redirect: 'manual'` 走 net.request，其余交给 fallback（net.fetch）。
 * 主进程（播放代理）与后台引擎 utilityProcess 共用：两边的 net.fetch 是同一份实现，都不支持 manual。
 * @param request net.request
 * @param fallback net.fetch
 */
export function manualRedirectFetch(
  request: RequestFactory,
  fallback: FetchImpl,
  options: ManualRedirectOptions = {}
): FetchImpl {
  return (url, init) => {
    if (init.redirect !== 'manual') return fallback(url, init)
    return new Promise<Response>((resolve, reject) => {
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
        credentials: options.credentials ?? 'omit',
        useSessionCookies: false,
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
      if (typeof init.body === 'string') req.write(init.body)
      req.end()
    })
  }
}
