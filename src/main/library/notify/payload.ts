/**
 * 外部变更通知的请求体 → FileChangeNotice[]。认两种格式：
 *
 * 1. CloudDrive2 文件变更 webhook（webhook.toml 的 [file_system_watcher] 默认 body 模板）：
 *    { "event_category": "file", "event_name": "notify", "data": [
 *        { "action": "create|delete|rename|modify", "is_dir": "true|false",
 *          "source_file": "/115/电影/A.mkv", "destination_file": "/115/电影/B.mkv" } ] }
 *    destination_file 只在 rename（含移动）时有值，其余动作是空串；is_dir 不用（一律重读父目录）。
 *    同一地址收到 [mount_point_watcher] 的挂载事件（data 里是 mount_point、没有 source_file）时忽略。
 * 2. 通用 JSON（脚本 / 其他工具）：{ "action": "...", "path": "...", "destination_path": "..." }，
 *    或这样的对象组成的数组。action 取值同上。
 *
 * 认不出的动作逐条跳过；整体既不是 CloudDrive2 格式也不是通用格式时抛 NotifyPayloadError（端点回 400）。
 */
import {
  FILE_CHANGE_ACTIONS,
  type FileChangeAction,
  type FileChangeNotice,
} from '../../../shared/library/ipc'

/** 请求体格式不对。 */
export class NotifyPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotifyPayloadError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** 一条（动作, 路径, 目标路径）→ 通知；动作不认识或路径为空返回 null。 */
function notice(
  action: unknown,
  path: unknown,
  destination: unknown
): FileChangeNotice | null {
  const act = text(action).toLowerCase() as FileChangeAction
  const from = text(path)
  if (!FILE_CHANGE_ACTIONS.includes(act) || !from) return null
  const to = text(destination)
  return to
    ? { action: act, path: from, destination: to }
    : { action: act, path: from }
}

/** 通用格式的一项。 */
function genericItem(item: unknown): FileChangeNotice | null {
  if (!isRecord(item) || !('path' in item)) {
    throw new NotifyPayloadError('每一项都要有 action 与 path')
  }
  return notice(item.action, item.path, item.destination_path)
}

/** 解析请求体（已 JSON.parse）。 */
export function parseNotifyPayload(body: unknown): FileChangeNotice[] {
  const out: FileChangeNotice[] = []
  const keep = (n: FileChangeNotice | null): void => {
    if (n) out.push(n)
  }
  if (isRecord(body) && Array.isArray(body.data)) {
    for (const item of body.data) {
      if (isRecord(item))
        keep(notice(item.action, item.source_file, item.destination_file))
    }
    return out
  }
  if (Array.isArray(body)) {
    for (const item of body) keep(genericItem(item))
    return out
  }
  if (isRecord(body)) {
    keep(genericItem(body))
    return out
  }
  throw new NotifyPayloadError(
    '请求体要是 CloudDrive2 webhook 的 JSON，或 { action, path, destination_path }'
  )
}
