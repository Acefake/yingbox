/**
 * IPC 边界上媒体库自动化相关参数的解析：自动化设置（部分字段）、updateLibrary。
 * 非法时抛 LibraryError（invalid-params）。
 */
import {
  LIBRARY_AUTO_WRITE,
  type LibraryAutoWrite,
  type LibraryAutomation,
  type UpdateLibraryRequest,
} from './contract-library'
import { LibraryError } from './wire'

const invalid = (message: string): never => {
  throw new LibraryError('invalid-params', message)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** 解析部分自动化设置：只认识的字段、类型必须对；缺省（undefined）返回 undefined。 */
export function parseAutomationPatch(
  input: unknown
): Partial<LibraryAutomation> | undefined {
  if (input === undefined) return undefined
  if (!isRecord(input)) return invalid('automation 必须是对象')
  const out: Partial<LibraryAutomation> = {}
  for (const key of ['watch', 'identify', 'organize'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') invalid(`automation.${key} 必须是布尔值`)
    out[key] = value as boolean
  }
  if (input.write !== undefined) {
    if (!LIBRARY_AUTO_WRITE.includes(input.write as LibraryAutoWrite)) {
      invalid(`automation.write 只能是 ${LIBRARY_AUTO_WRITE.join(' / ')}`)
    }
    out.write = input.write as LibraryAutoWrite
  }
  return out
}

/** 解析 updateLibrary：libraryId 必填，name / automation 至少给一个。 */
export function parseUpdateLibrary(input: unknown): UpdateLibraryRequest {
  if (!isRecord(input)) return invalid('updateLibrary 参数必须是对象')
  const id = input.libraryId
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    invalid('libraryId 必须是正整数')
  }
  let name: string | undefined
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      invalid('name 必须是非空字符串')
    }
    name = (input.name as string).trim()
  }
  const automation = parseAutomationPatch(input.automation)
  if (name === undefined && automation === undefined) {
    invalid('name 与 automation 至少提供一个')
  }
  return { libraryId: id as number, name, automation }
}
