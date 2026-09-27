import { lookup } from 'node:dns/promises'

import { createWriteStream } from 'node:fs'

import { unlink } from 'node:fs/promises'

import { randomUUID } from 'node:crypto'

import { Readable } from 'node:stream'

import { pipeline } from 'node:stream/promises'

import { replaceFile, withPathLocks } from './file-operations'

const MAX_REDIRECTS = 5

// ── 内网地址判定（与 Go 后端 isPrivateHost/isPrivateIP 对齐） ──

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')

  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null

    const v = Number(p)

    if (v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)

  if (b === null) return false

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0

  return (ipInt & mask) === (b & mask)
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)

  if (n === null) return false
  return (
    inCidr(n, '127.0.0.0', 8) || // loopback
    inCidr(n, '10.0.0.0', 8) || // private
    inCidr(n, '172.16.0.0', 12) || // private
    inCidr(n, '192.168.0.0', 16) || // private
    inCidr(n, '169.254.0.0', 16) || // link-local
    inCidr(n, '100.64.0.0', 10) || // CGNAT
    inCidr(n, '0.0.0.0', 8) || // unspecified/current
    inCidr(n, '192.0.2.0', 24) || // TEST-NET-1
    inCidr(n, '198.51.100.0', 24) || // TEST-NET-2
    inCidr(n, '203.0.113.0', 24) || // TEST-NET-3
    inCidr(n, '224.0.0.0', 4) || // multicast
    inCidr(n, '240.0.0.0', 4) // reserved
  )
}

export function isPrivateIPLiteral(ip: string): boolean {
  const host = ip.split('%')[0].toLowerCase() // 去掉 IPv6 zone id

  // IPv4-mapped IPv6（如 ::ffff:192.168.1.1）按内嵌 IPv4 判定
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)

  if (mapped) return isPrivateIPv4(mapped[1])
  if (host.includes('.') && !host.includes(':')) return isPrivateIPv4(host)
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true

    const first = host.split(':')[0]

    if (first === '') return true // :: 开头的未指定/兼容地址一律拒绝

    const v = parseInt(first, 16)

    if (Number.isNaN(v)) return false
    if (v >= 0xfe80 && v <= 0xfebf) return true // fe80::/10 link-local
    if ((v & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
    if ((v & 0xff00) === 0xff00) return true // ff00::/8 multicast
    return false
  }
  return false
}

// 是否为字面量 IP（v4 / [...] 包裹或裸 v6 由 URL.hostname 规范化）
function looksLikeIP(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':')
}

/**
 * 目标主机安全检查：拒绝回环/内网/保留地址。
 * 域名经 DNS 解析，只要任一 A/AAAA 记录命中内网段即拒绝（防恶意域名指向内网）。
 * 解析失败直接拒绝——解析失败的请求本来也发不出去，fail-closed 更安全。
 * 注意：检查与请求之间存在 TOCTOU 窗口（DNS 重绑定），本机 Electron 场景下残余风险可接受；
 * 内网高敏环境请走 Go 后端代理并收紧出口。
 */
export async function assertPublicTarget(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('无效的 URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 HTTP/HTTPS 地址')
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1') // URL.hostname 对 IPv6 保留方括号

  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('不允许请求内网地址')
  }
  if (looksLikeIP(host)) {
    if (isPrivateIPLiteral(host)) throw new Error('不允许请求内网地址')
    return
  }
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new Error(`无法解析主机：${host}`)
  }
  if (addrs.some(a => isPrivateIPLiteral(a.address))) {
    throw new Error('不允许请求内网地址')
  }
}

async function fetchNoAutoRedirect(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  })
}

/**
 * 带 SSRF 防护的请求：初始目标与每一跳重定向都要过内网检查。
 * fetch 默认自动跟随重定向会被 302 绕过检查，因此改为手动跟随。
 */
export async function fetchHttp(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 HTTP/HTTPS 地址')
  let current = url
  let method = (options.method ?? 'GET').toUpperCase()
  let body = options.body

  const headers = options.headers

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicTarget(current)

    const response = await fetchNoAutoRedirect(
      current,
      { ...options, method, headers, body },
      timeoutMs
    )

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.get('location')

      await response.body?.cancel().catch(() => {})
      if (!location) throw new Error('重定向缺少 Location')
      if (hop === MAX_REDIRECTS) throw new Error('重定向次数过多')
      current = new URL(location, current).toString()
      // 303 一律转 GET；301/302 上 POST 转 GET（浏览器一致行为）
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === 'POST')
      ) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response
  }
  throw new Error('重定向次数过多')
}

export async function readLimited(
  response: Response,
  maxBytes = 16 * 1024 * 1024
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()

  const chunks: Uint8Array[] = []

  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()

      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('响应内容超过大小限制')
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function downloadFile(
  url: string,
  filePath: string
): Promise<void> {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${randomUUID()}.partial`

    try {
      const response = await fetchHttp(url, {}, 60000)

      if (!response.body) throw new Error('下载响应为空')
      await pipeline(
        Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream<Uint8Array>
        ),
        createWriteStream(temporary, { flags: 'wx' })
      )
      await replaceFile(temporary, filePath)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  })
}
