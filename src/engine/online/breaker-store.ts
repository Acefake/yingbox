/**
 * 在线插件源熔断的持久化：未过期的熔断存在 userData/online/breaker.json，
 * 引擎重启后恢复，被封的站点不会因为重启又被请求一遍、又弹一次验证窗口。
 * 只存熔断，不存连续失败计数。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type HostBreaker,
  type HostBreakerOptions,
  type HostTrip,
  createHostBreaker,
  pathScope,
} from '../../shared/net/host-breaker'

const REASONS = new Set(['blocked', 'challenge', 'unreachable', 'plugin'])
const SCOPES = new Set(['search', 'browse', undefined])

/** 读出文件里形状正确的熔断；文件不存在或损坏时返回空表。 */
export function readTrips(file: string): HostTrip[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(value)) return []
    return value.filter(
      (t): t is HostTrip =>
        !!t &&
        typeof t.host === 'string' &&
        typeof t.until === 'number' &&
        REASONS.has(t.reason) &&
        SCOPES.has(t.scope)
    )
  } catch {
    return []
  }
}

/** 先写临时文件再改名，写到一半退出也不会留下半个文件。 */
function writeTrips(file: string, trips: HostTrip[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(trips))
    renameSync(`${file}.tmp`, file)
  } catch {
    // 写盘失败只影响重启后的恢复，不影响本次运行的熔断
  }
}

/** 在线域用的熔断器：按主机 + 路径类别，状态落盘。 */
export function createPersistentBreaker(
  file: string,
  options: Omit<HostBreakerOptions, 'restore' | 'onChange' | 'scopeOf'> = {}
): HostBreaker {
  return createHostBreaker({
    ...options,
    scopeOf: pathScope,
    restore: readTrips(file),
    onChange: trips => writeTrips(file, trips),
  })
}
