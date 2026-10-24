/**
 * 最小 WebDAV 客户端：只做媒体库需要的 PROPFIND（列目录、取目录属性）。
 * 出网实现由调用方注入（主进程、媒体库引擎都用 Node fetch，局域网 NAS 是内网地址，不走 SSRF 防护）。
 *
 * 错误分类成 DavError.code，界面据此给出能看懂的提示：
 * auth（401 / 403，用户名或密码不对）、not-found（404）、timeout、network（连不上）、protocol（不是 WebDAV 响应）。
 */
import { type DavEntry, PROPFIND_BODY, parseMultistatus } from './propfind'
import { encodeRemotePath, normalizeRemotePath } from './remote-path'

/** 连接一个源需要的信息（只在主进程和媒体库引擎里出现）。 */
export interface DavAccess {
  /** 源地址，如 http://192.168.1.5:5244/dav（Alist）或 https://nas.local:5006。 */
  url: string
  username: string
  password: string
}

/** 出网函数：Node / Electron 的 fetch 子集。 */
export type DavFetch = (url: string, init: RequestInit) => Promise<Response>

/** 错误类别。 */
export type DavErrorCode =
  | 'auth'
  | 'not-found'
  | 'timeout'
  | 'network'
  | 'protocol'
  | 'http'

/** WebDAV 请求失败。 */
export class DavError extends Error {
  constructor(
    readonly code: DavErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'DavError'
  }
}

/** 单次请求的默认超时。 */
export const DAV_TIMEOUT_MS = 20_000

/** 源地址是否可用：http / https、有主机、不带查询串与片段。 */
export function validDavUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

/** 源地址的路径部分（解码后，用来把 href 换算成相对路径）。 */
export function davBasePath(url: string): string {
  const { pathname } = new URL(url)
  try {
    return normalizeRemotePath(decodeURIComponent(pathname))
  } catch {
    return normalizeRemotePath(pathname)
  }
}

/** 源地址 + 远程路径 → 请求地址；目录可要求结尾斜杠（部分服务端对目录不带斜杠会 301）。 */
export function davUrl(base: string, path: string, dir = false): string {
  const root = base.replace(/\/+$/, '')
  const encoded = encodeRemotePath(path)
  const tail = encoded === '/' ? '/' : dir ? `${encoded}/` : encoded
  return `${root}${tail}`
}

/** Basic 认证头；没有用户名时不发。 */
export function authHeader(access: DavAccess): string | undefined {
  if (!access.username) return undefined
  const raw = `${access.username}:${access.password}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

/** HTTP 状态 → 错误类别与中文说明。 */
export function davStatusError(status: number): DavError {
  if (status === 401 || status === 403)
    return new DavError('auth', '用户名或密码不对，或没有访问权限', status)
  if (status === 404) return new DavError('not-found', '远程目录不存在', status)
  if (status === 405 || status === 501)
    return new DavError('protocol', '这个地址不支持 WebDAV（PROPFIND）', status)
  return new DavError('http', `服务器返回 ${status}`, status)
}

/**
 * 207 里有资源级失败时抛错：请求的目录本身失败按它的状态码分类（403 → auth 等）；
 * 子项失败按 http 类处理（不归为 not-found，免得调用方把整个目录当成已删除）。
 * 不能把失败项当空目录交出去，否则扫描会把已有记录全部删掉。
 */
function throwOnFailure(entries: DavEntry[], path: string): void {
  for (const entry of entries) {
    if (entry.failure === undefined) continue
    if (entry.path === path) throw davStatusError(entry.failure)
    throw new DavError(
      'http',
      `子项 ${entry.path} 读取失败（服务器返回 ${entry.failure}）`,
      entry.failure
    )
  }
}

/** PROPFIND 客户端。 */
export interface DavClient {
  /** 列目录（Depth: 1）或只取目录本身（Depth: 0），结果路径相对源根目录。 */
  propfind(
    path: string,
    depth: 0 | 1,
    signal?: AbortSignal
  ): Promise<DavEntry[]>
}

/** 建客户端。 */
export function createDavClient(
  access: DavAccess,
  fetch: DavFetch,
  timeoutMs = DAV_TIMEOUT_MS
): DavClient {
  const basePath = davBasePath(access.url)
  const auth = authHeader(access)
  return {
    async propfind(path, depth, signal) {
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      let response: Response
      try {
        response = await fetch(davUrl(access.url, path, true), {
          method: 'PROPFIND',
          headers: {
            Depth: String(depth),
            'Content-Type': 'application/xml; charset=utf-8',
            ...(auth ? { Authorization: auth } : {}),
          },
          body: PROPFIND_BODY,
          signal: combined,
        })
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        if (timeout.aborted)
          throw new DavError('timeout', `连接超时（${timeoutMs / 1000} 秒）`)
        throw new DavError(
          'network',
          `连不上服务器：${(error as Error).message}`
        )
      }
      if (response.status !== 207) {
        await response.body?.cancel()
        // 200 说明是普通网页（地址不是 WebDAV 端点）
        throw response.ok
          ? new DavError(
              'protocol',
              '这个地址不是 WebDAV 端点',
              response.status
            )
          : davStatusError(response.status)
      }
      const entries = parseMultistatus(await response.text(), basePath)
      throwOnFailure(entries, normalizeRemotePath(path))
      return entries
    },
  }
}
