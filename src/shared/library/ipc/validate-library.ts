/**
 * IPC 边界上媒体库自动化相关参数的解析：自动化设置（部分字段）、updateLibrary、外部变更通知。
 * 非法时抛 LibraryError（invalid-params）。
 */
import {
  FILE_CHANGE_ACTIONS,
  type FileChangeAction,
  type FileChangeNotice,
  LIBRARY_AUTO_WRITE,
  LIBRARY_STORAGE,
  type LibraryAutoWrite,
  type LibraryAutomation,
  type LibraryStorage,
  type NotifyChangesRequest,
  type UpdateLibraryRequest,
} from './contract-library'
import { LibraryError } from './wire'
import { asRecord, oneOf, positiveId } from './validate-base'

/** 解析条目分类纠正请求。 */
export function parseReclassifyItem(input: unknown): {
  itemId: number
  kind: 'movie' | 'tv'
} {
  const r = asRecord(input, 'reclassifyItem 参数')
  return {
    itemId: positiveId(r.itemId, 'itemId'),
    kind: oneOf(r.kind, ['movie', 'tv'] as const, 'kind'),
  }
}

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
  if (input.storage !== undefined) {
    if (!LIBRARY_STORAGE.includes(input.storage as LibraryStorage)) {
      invalid(`automation.storage 只能是 ${LIBRARY_STORAGE.join(' / ')}`)
    }
    out.storage = input.storage as LibraryStorage
  }
  return out
}

/** 一次变更通知最多几条（网盘整季离线完成也就几百条）。 */
export const MAX_CHANGE_NOTICES = 10_000

/** 非空、单行、不超过 4096 字符的路径。 */
function noticePath(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    /[\0\r\n]/.test(value)
  ) {
    return invalid(`${name} 必须是非空路径`)
  }
  return value.trim()
}

/** 解析 notifyChanges：changes 非空数组，每条 action / path 必填，destination 可选。 */
export function parseNotifyChanges(input: unknown): NotifyChangesRequest {
  if (!isRecord(input)) return invalid('notifyChanges 参数必须是对象')
  const list = input.changes
  if (!Array.isArray(list) || !list.length) invalid('changes 必须是非空数组')
  if ((list as unknown[]).length > MAX_CHANGE_NOTICES) {
    invalid(`changes 一次最多 ${MAX_CHANGE_NOTICES} 条`)
  }
  const changes = (list as unknown[]).map((raw): FileChangeNotice => {
    if (!isRecord(raw)) return invalid('changes 的每一项必须是对象')
    if (!FILE_CHANGE_ACTIONS.includes(raw.action as FileChangeAction)) {
      invalid(`action 只能是 ${FILE_CHANGE_ACTIONS.join(' / ')}`)
    }
    const notice: FileChangeNotice = {
      action: raw.action as FileChangeAction,
      path: noticePath(raw.path, 'path'),
    }
    if (raw.destination !== undefined && raw.destination !== '')
      notice.destination = noticePath(raw.destination, 'destination')
    return notice
  })
  const mountRoot =
    input.mountRoot === undefined || input.mountRoot === ''
      ? undefined
      : noticePath(input.mountRoot, 'mountRoot')
  return mountRoot ? { changes, mountRoot } : { changes }
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
  if (input.mixed !== undefined && input.mixed !== true) {
    invalid('mixed 只能为 true')
  }
  if (
    name === undefined &&
    automation === undefined &&
    input.mixed === undefined
  ) {
    invalid('name、automation 与 mixed 至少提供一个')
  }
  return {
    libraryId: id as number,
    name,
    automation,
    ...(input.mixed === true ? { mixed: true } : {}),
  }
}
