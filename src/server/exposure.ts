/**
 * 对外监听的检查（ADR-0010，修订见文末）。
 *
 * 服务默认只听 127.0.0.1。监听 0.0.0.0、局域网 IP 或主机名（`--host` / `YINGBOX_HOST`）就是对外提供服务：
 * - 没设访问令牌：照常启动、不鉴权，启动日志打一行警告（{@link exposureWarning}）——局域网里任何人都能访问；
 * - 设了访问令牌 `YINGBOX_SERVER_TOKEN`：它就是对外的唯一门槛，必须至少 {@link MIN_EXPOSED_TOKEN_LENGTH} 个字符、
 *   且不是示例里的占位串，否则拒绝启动（{@link exposureProblem}），免得一个弱令牌给人“已加固”的错觉。
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

/** 对外监听且设了不合格的访问令牌时返回原因（给人看的整句），否则 null（没设令牌也是 null）。 */
export function exposureProblem(
  host: string,
  env: NodeJS.ProcessEnv
): string | null {
  if (isLoopbackHost(host)) return null
  const token = env.YINGBOX_SERVER_TOKEN?.trim() ?? ''
  if (!token) return null
  const fix = `对外监听（${host}）时访问令牌 YINGBOX_SERVER_TOKEN 至少要 ${MIN_EXPOSED_TOKEN_LENGTH} 个字符的随机串（例如 openssl rand -base64 32 的输出）；不需要鉴权就删掉这个变量。`
  if (token.length < MIN_EXPOSED_TOKEN_LENGTH)
    return `访问令牌只有 ${token.length} 个字符。${fix}`
  if (PLACEHOLDER.test(token)) return `访问令牌还是示例里的占位串。${fix}`
  return null
}

/** 对外监听且没设访问令牌时返回一行警告，否则 null。 */
export function exposureWarning(
  host: string,
  env: NodeJS.ProcessEnv
): string | null {
  if (isLoopbackHost(host) || env.YINGBOX_SERVER_TOKEN?.trim()) return null
  return `正在对外监听（${host}）且没有设置访问令牌：局域网内任何人都能访问片库。需要时设置 YINGBOX_SERVER_TOKEN（至少 ${MIN_EXPOSED_TOKEN_LENGTH} 个字符）开启登录。`
}
