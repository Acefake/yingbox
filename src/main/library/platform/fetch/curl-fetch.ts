/**
 * 经 curl 命令行出网：给需要浏览器 TLS / HTTP2 指纹的站点接 curl-impersonate 用。
 *
 * curl-impersonate 的包装脚本（如 curl_chrome116）与普通 curl 命令行兼容，
 * 把 binary 指向它即可模仿 Chrome 指纹；不指定时用系统 curl（行为与 Node fetch 相近，主要用于验证接线）。
 *
 * 一次请求 = 一个 curl 进程：`-D -` 把（含重定向的）每段响应头写到 stdout，正文紧随最后一段头之后，
 * parseCurlOutput 拆出最终状态码、响应头和正文。超时、取消都直接结束子进程。
 * 代理沿用 curl 自己的环境变量（HTTPS_PROXY 等）。
 */
import { spawn } from 'node:child_process'
import type { HttpFetch } from '../../identify/identify-module'

/** 参数。 */
export interface CurlFetchOptions {
  /** curl 可执行文件，默认 'curl'；curl-impersonate 填它的包装脚本路径。 */
  binary?: string
  /** 响应体上限，默认 32 MB（海报原图上限 15 MB，留余量）。 */
  maxBytes?: number
  /** 单次请求超时，默认 30 s（调用方的 signal 通常更早结束）。 */
  timeoutMs?: number
  /** 子进程启动函数，测试注入。 */
  spawnImpl?: typeof spawn
}

/** 解析出的最终响应。 */
export interface CurlResponse {
  status: number
  headers: Array<[string, string]>
  body: Buffer
}

const HEADER_END = Buffer.from('\r\n\r\n')
const STATUS_RE = /^HTTP\/[\d.]+ (\d{3})/

/**
 * 把 `curl -D - -o -` 的输出拆成最终响应。重定向、100 Continue、代理 CONNECT 都会多出一段头，
 * 后面紧跟着另一段 "HTTP/" 头的就是中间响应，跳过。
 */
export function parseCurlOutput(output: Buffer): CurlResponse {
  let offset = 0
  for (;;) {
    const end = output.indexOf(HEADER_END, offset)
    if (end < 0) throw new Error('curl 输出缺少响应头')
    const lines = output.toString('latin1', offset, end).split('\r\n')
    const match = STATUS_RE.exec(lines[0] ?? '')
    if (!match) throw new Error(`curl 输出格式不对：${lines[0] ?? ''}`)
    const next = end + HEADER_END.length
    if (output.toString('latin1', next, next + 5) === 'HTTP/') {
      offset = next
      continue
    }
    const headers: Array<[string, string]> = []
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(':')
      if (colon > 0)
        headers.push([
          line.slice(0, colon).trim(),
          line.slice(colon + 1).trim(),
        ])
    }
    return { status: Number(match[1]), headers, body: output.subarray(next) }
  }
}

/**
 * 拼 curl 参数（纯函数，便于测试）。
 * body 有值时发 POST（--data-binary）；不加 --request，重定向后按 curl 默认改成 GET，与 fetch 一致。
 */
export function curlArgs(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  timeoutMs: number,
  body?: string
): string[] {
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--max-redirs',
    '5',
    '--compressed',
    '--dump-header',
    '-',
    '--max-filesize',
    String(maxBytes),
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
  ]
  for (const [name, value] of Object.entries(headers)) {
    // 头里不允许换行，防止经参数注入额外的头
    if (/[\r\n]/.test(name + value)) continue
    args.push('--header', `${name}: ${value}`)
  }
  // 带请求体即 POST（--data-binary 原样发送，不做 URL 编码；重定向后保持 POST 语义）
  if (body !== undefined) args.push('--data-binary', body)
  args.push('--', url)
  return args
}

/** 无正文的状态码（Response 构造函数不允许给它们 body）。 */
const NULL_BODY = new Set([101, 204, 205, 304])

/** 创建经 curl 出网的实现。 */
export function createCurlFetch(options: CurlFetchOptions = {}): HttpFetch {
  const binary = options.binary || 'curl'
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 30_000
  const run = options.spawnImpl ?? spawn
  return ((
    url: string,
    init: {
      headers?: Record<string, string>
      signal?: AbortSignal
      method?: 'GET' | 'POST'
      body?: string
    }
  ) =>
    new Promise<Response>((resolve, reject) => {
      if (!/^https?:\/\//i.test(url)) {
        reject(new Error(`curl 只支持 http(s)：${url}`))
        return
      }
      init.signal?.throwIfAborted()
      const child = run(
        binary,
        curlArgs(
          url,
          init.headers ?? {},
          maxBytes,
          timeoutMs,
          (init.method ?? (init.body !== undefined ? 'POST' : 'GET')) === 'POST'
            ? (init.body ?? '')
            : undefined
        ),
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }
      )
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      const abort = (): void => {
        child.kill()
        reject(init.signal?.reason ?? new Error('请求已取消'))
      }
      init.signal?.addEventListener('abort', abort, { once: true })
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length
        // 头 + 正文的硬上限（--max-filesize 只在服务端给了长度时生效）
        if (size > maxBytes + 64 * 1024) {
          child.kill()
          return
        }
        chunks.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString()
      })
      child.on('error', error => {
        init.signal?.removeEventListener('abort', abort)
        reject(new Error(`无法启动 ${binary}：${error.message}`))
      })
      child.on('close', code => {
        init.signal?.removeEventListener('abort', abort)
        if (init.signal?.aborted) return
        if (code !== 0) {
          reject(
            new Error(`curl 失败（${code}）：${stderr.trim() || '无输出'}`)
          )
          return
        }
        try {
          const parsed = parseCurlOutput(Buffer.concat(chunks))
          const body = NULL_BODY.has(parsed.status)
            ? null
            : new Uint8Array(parsed.body)
          resolve(
            new Response(body, {
              status: parsed.status,
              headers: parsed.headers.filter(
                // 正文已由 --compressed 解压，原编码与长度头不再成立
                ([name]) =>
                  !/^(content-encoding|content-length|transfer-encoding)$/i.test(
                    name
                  )
              ),
            })
          )
        } catch (error) {
          reject(error)
        }
      })
    })) as HttpFetch
}
