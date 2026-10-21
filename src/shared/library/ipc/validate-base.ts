/**
 * IPC 边界参数解析的共用小工具：类型不对时抛 LibraryError（invalid-params）。
 */
import { LibraryError } from './wire'

/** 抛出参数错误。 */
export const invalid = (message: string): never => {
  throw new LibraryError('invalid-params', message)
}

/** 对象参数；undefined / null 视为空对象。 */
export function asRecord(
  value: unknown,
  what: string
): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    return invalid(`${what} 必须是对象`)
  }
  return value as Record<string, unknown>
}

/** 正的安全整数 id。 */
export function positiveId(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(`${name} 必须是正整数`)
  }
  return value as number
}

/** 可选整数，不小于 min。 */
export function optionalInt(
  value: unknown,
  name: string,
  min: number
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    return invalid(`${name} 必须是不小于 ${min} 的整数`)
  }
  return value as number
}

/** 枚举值。 */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string
): T {
  if (!allowed.includes(value as T)) {
    return invalid(`${name} 只能是 ${allowed.join(' / ')}`)
  }
  return value as T
}

/** 可选的枚举数组（去重，空数组视为未给）。 */
export function listOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string
): T[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return invalid(`${name} 必须是数组`)
  const unique = [...new Set(value.map(v => oneOf(v, allowed, name)))]
  return unique.length ? unique : undefined
}
