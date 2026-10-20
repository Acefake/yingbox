/**
 * 出网安全策略：判断目标是否指向内网 / 回环 / 保留地址（防 SSRF）。
 *
 * 纯函数 + 注入的 DNS 解析，主进程与引擎共用；本文件不得 import 任何 node 模块。
 */

/** DNS 解析函数：返回主机的全部 A / AAAA 地址（node:dns/promises 的 lookup all 形状）。 */
export type LookupAll = (host: string) => Promise<Array<{ address: string }>>

/** 目标被策略拒绝。 */
export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedTargetError'
  }
}

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
  const b = ipv4ToInt(base) as number
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (b & mask)
}

const PRIVATE_V4: Array<[string, number]> = [
  ['127.0.0.0', 8], // 回环
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16], // 链路本地
  ['100.64.0.0', 10], // CGNAT
  ['0.0.0.0', 8],
  ['192.0.2.0', 24], // TEST-NET
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // 组播
  ['240.0.0.0', 4], // 保留
]

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return false
  return PRIVATE_V4.some(([base, bits]) => inCidr(n, base, bits))
}

/** IP 字面量是否属于不可对外访问的网段（含 IPv4 映射的 IPv6）。 */
export function isPrivateIPLiteral(ip: string): boolean {
  const host = ip.split('%')[0].toLowerCase()
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (host.includes('.') && !host.includes(':')) return isPrivateIPv4(host)
  if (!host.includes(':')) return false
  if (host === '::1' || host === '::') return true
  const first = host.split(':')[0]
  if (first === '') return true
  const v = parseInt(first, 16)
  if (Number.isNaN(v)) return false
  return (
    (v >= 0xfe80 && v <= 0xfebf) || // fe80::/10
    (v & 0xfe00) === 0xfc00 || // fc00::/7
    (v & 0xff00) === 0xff00 // ff00::/8
  )
}

const looksLikeIP = (host: string): boolean =>
  /^[\d.]+$/.test(host) || host.includes(':')

/**
 * 目标主机安全检查：只允许 http/https 的公网地址。
 *
 * 域名经 DNS 解析，任一记录命中内网段即拒绝；解析失败也拒绝（fail-closed）。
 * 检查与真正连接之间存在 DNS 重绑定窗口，本机桌面场景下可接受。
 */
export async function assertPublicTarget(
  rawUrl: string,
  lookup: LookupAll
): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new BlockedTargetError('无效的 URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedTargetError('仅支持 HTTP/HTTPS 地址')
  }
  if (parsed.username || parsed.password) {
    throw new BlockedTargetError('URL 不允许携带账号密码')
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw new BlockedTargetError('不允许请求内网地址')
  }
  if (looksLikeIP(host)) {
    if (isPrivateIPLiteral(host))
      throw new BlockedTargetError('不允许请求内网地址')
    return parsed
  }
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host)
  } catch {
    throw new BlockedTargetError(`无法解析主机：${host}`)
  }
  if (addrs.some(a => isPrivateIPLiteral(a.address))) {
    throw new BlockedTargetError('不允许请求内网地址')
  }
  return parsed
}
