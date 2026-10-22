/**
 * 对外监听的门槛（ADR-0010）。
 *
 * 服务默认只听 127.0.0.1。监听 0.0.0.0、局域网 IP 或主机名（`--host` / `YINGBOX_HOST`）就是对外提供服务，
 * 这时必须显式设置访问令牌 `YINGBOX_SERVER_TOKEN`：至少 {@link MIN_EXPOSED_TOKEN_LENGTH} 个字符，且不是示例里的占位串。
 * 首次启动自动生成的令牌只适合本机：它会打印进日志，NAS 面板与日志收集里谁都能看到。
 */
import { isIPv4, isIPv6 } from 'node:net'

/** 对外监听时访问令牌的最短长度。 */
export const MIN_EXPOSED_TOKEN_LENGTH = 24

/** 示例文件里的占位串都含这个词。 */
const PLACEHOLDER = /change-?me/i

/** 只有本机能连上的地址：localhost、127.0.0.0/8、::1（含 IPv4 映射形式）。 */
export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (bare === 'localhost') return true
  const v4 = bare.startsWith('::ffff:') ? bare.slice(7) : bare
  if (isIPv4(v4)) return v4.startsWith('127.')
  return isIPv6(bare) && bare.replace(/^(0{0,4}:)+/, '') === '1'
}

/** 对外监听却没有合格令牌时返回原因（给人看的整句），否则 null。 */
export function exposureProblem(
  host: string,
  env: NodeJS.ProcessEnv
): string | null {
  if (isLoopbackHost(host)) return null
  const token = env.YINGBOX_SERVER_TOKEN?.trim() ?? ''
  const fix = `对外监听（${host}）必须设置访问令牌 YINGBOX_SERVER_TOKEN（至少 ${MIN_EXPOSED_TOKEN_LENGTH} 个字符的随机串，例如 openssl rand -base64 32 的输出）；只在本机用就去掉 --host / YINGBOX_HOST。`
  if (!token) return `没有设置访问令牌。${fix}`
  if (token.length < MIN_EXPOSED_TOKEN_LENGTH)
    return `访问令牌只有 ${token.length} 个字符。${fix}`
  if (PLACEHOLDER.test(token)) return `访问令牌还是示例里的占位串。${fix}`
  return null
}
