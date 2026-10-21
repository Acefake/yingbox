/**
 * 极简路由：方法 + 路径模式（`/media/image/:key`），外加几个响应助手。
 * 路由不多（十来条），线性匹配足够；不引入框架，产物只依赖 Node。
 */

/** 路由上下文。 */
export interface RouteContext {
  url: URL
  /** 路径参数（已 decodeURIComponent）。 */
  params: Record<string, string>
}

/** 路由处理函数。 */
export type RouteHandler = (
  request: Request,
  context: RouteContext
) => Response | Promise<Response>

/** 一条路由。 */
interface Route {
  method: string
  segments: string[]
  handler: RouteHandler
  /** 不需要令牌（健康检查、登录、网页静态文件）。 */
  public: boolean
}

/** 匹配结果。 */
export interface RouteMatch {
  handler: RouteHandler
  params: Record<string, string>
  public: boolean
}

const split = (path: string): string[] => path.split('/').filter(Boolean)

/** 路由表。 */
export class Router {
  private readonly routes: Route[] = []

  /** 登记一条路由；pattern 里 `:name` 匹配一段。 */
  add(
    method: string,
    pattern: string,
    handler: RouteHandler,
    options: { public?: boolean } = {}
  ): this {
    this.routes.push({
      method,
      segments: split(pattern),
      handler,
      public: options.public ?? false,
    })
    return this
  }

  /** 找路由；HEAD 可以命中 GET。路径存在但方法不对时返回 'method-not-allowed'。 */
  match(
    method: string,
    pathname: string
  ): RouteMatch | 'method-not-allowed' | null {
    const parts = split(pathname)
    let pathMatched = false
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts)
      if (!params) continue
      pathMatched = true
      if (
        route.method === method ||
        (method === 'HEAD' && route.method === 'GET')
      )
        return { handler: route.handler, params, public: route.public }
    }
    return pathMatched ? 'method-not-allowed' : null
  }
}

function matchSegments(
  pattern: string[],
  parts: string[]
): Record<string, string> | null {
  if (pattern.length !== parts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i]
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(parts[i])
      } catch {
        return null
      }
    } else if (want !== parts[i]) return null
  }
  return params
}

/** JSON 响应（不缓存）。 */
export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

/** 纯文本错误响应。 */
export function fail(status: number, message: string): Response {
  return json({ error: message }, status)
}

/** 读 JSON 请求体，超过上限或不是 JSON 时抛 HttpError。 */
export async function readJson(
  request: Request,
  maxBytes = 1024 * 1024
): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? ''))
    throw new HttpError(415, '请求体必须是 application/json')
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new HttpError(413, '请求体过大')
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new HttpError(413, '请求体过大')
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON')
  }
}

/** 带状态码的错误（路由里抛出，入口转成响应）。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
