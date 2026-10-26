/**
 * 播放代理的出网目标校验：默认与引擎相同，只允许无凭据的公网 http/https（shared/net/guard）。
 * 显式配置了 YINGBOX_STREAM_ALLOW_PRIVATE 时，名单里的目标放行：
 * - 主机名（如 nas.lan）：按名放行，不再看解析结果；
 * - IP 或 IPv4 CIDR（如 192.168.1.10、192.168.1.0/24）：IP 字面量命中，或域名解析出的内网地址全部落在名单内才放行。
 * 每一跳重定向都过这一关（shared/net/client 的 guard）。
 */
import {
  BlockedTargetError,
  type LookupAll,
  assertPublicTarget,
  isPrivateIPLiteral,
} from '../../../shared/net/guard'

/** 校验函数：通过返回解析好的 URL，拒绝时抛 BlockedTargetError。 */
export type StreamGuard = (url: string, lookup: LookupAll) => Promise<URL>

const ipv4 = (ip: string): number | null => {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p))) return null
  const values = parts.map(Number)
  if (values.some(v => v > 255)) return null
  return values.reduce((n, v) => n * 256 + v, 0) >>> 0
}

/** 一条放行规则 → 判断函数。 */
function matcher(rule: string): (host: string) => boolean {
  const [base, bitsText] = rule.split('/')
  const baseInt = ipv4(base)
  if (bitsText !== undefined && baseInt !== null) {
    const bits = Number(bitsText)
    if (!Number.isInteger(bits) || bits < 0 || bits > 32)
      throw new Error(`YINGBOX_STREAM_ALLOW_PRIVATE 里的网段不合法：${rule}`)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return host => {
      const n = ipv4(host.replace(/^::ffff:/, ''))
      return n !== null && (n & mask) === (baseInt & mask)
    }
  }
  const exact = rule.replace(/^\[(.*)\]$/, '$1')
  return host => host === exact
}

const hostOfUrl = (url: URL): string =>
  url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')

/** 按放行名单创建校验函数；名单为空时就是 assertPublicTarget。 */
export function createStreamGuard(allow: readonly string[]): StreamGuard {
  if (!allow.length) return assertPublicTarget
  const rules = allow.map(matcher)
  const allowed = (host: string): boolean => rules.some(rule => rule(host))
  return async (raw, lookup) => {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new BlockedTargetError('无效的 URL')
    }
    if (!['http:', 'https:'].includes(url.protocol))
      throw new BlockedTargetError('仅支持 HTTP/HTTPS 地址')
    if (url.username || url.password)
      throw new BlockedTargetError('URL 不允许携带账号密码')
    const host = hostOfUrl(url)
    if (allowed(host)) return url
    if (ipv4(host) === null && !host.includes(':')) {
      const addresses = await lookup(host).catch(() => [])
      const internal = addresses.filter(a => isPrivateIPLiteral(a.address))
      if (internal.length && internal.every(a => allowed(a.address))) return url
    }
    return assertPublicTarget(raw, lookup)
  }
}
