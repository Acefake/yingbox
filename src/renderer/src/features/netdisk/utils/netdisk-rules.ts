/**
 * 网盘页的纯函数：显示格式（分享、磁力、离线任务）与扫码轮询循环。
 */
import type { OfflineTask } from '../../../../../shared/contract/offline'
import type {
  MagnetItem,
  Pan115LoginPoll,
} from '../../../../../shared/contract/pan115'

/** 字节数 → 「1.5 GB」；0 显示为空串 */
export function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`
}

/** ISO 时间 → 「2026-10-01」；没有或不合法时为空串 */
export function formatDay(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 异常 → 给用户看的一句话 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** PanSou 来源 → 「TG · 频道」/「插件 · 名字」 */
export function sourceLabel(source: string): string {
  const [kind, ...rest] = source.split(':')
  const name = rest.join(':')
  if (kind === 'tg' && name) return `TG · ${name}`
  if (kind === 'plugin' && name) return `插件 · ${name}`
  return source === 'unknown' ? '' : source
}

/** 磁力行的来源标签：「磁力 · Torznab」「电驴 · PanSou」 */
export function magnetOriginLabel(item: MagnetItem): string {
  const kind = item.kind === 'ed2k' ? '电驴' : '磁力'
  return `${kind} · ${item.origin === 'torznab' ? 'Torznab' : 'PanSou'}`
}

/** 磁力行的说明：来源细节、大小、做种 / 下载人数、日期（没有的不显示） */
export function magnetMeta(item: MagnetItem): string[] {
  const source =
    item.origin === 'pansou' ? sourceLabel(item.source) : item.source
  const swarm =
    item.seeders === undefined
      ? ''
      : `${item.seeders} 做种${item.peers ? ` · ${item.peers} 下载` : ''}`
  return [
    source,
    formatBytes(item.size ?? 0),
    swarm,
    formatDay(item.datetime),
  ].filter(Boolean)
}

/** 一次轮询的最终结果（不再是 waiting / scanned） */
export type LoginOutcome = Exclude<
  Pan115LoginPoll,
  { status: 'waiting' } | { status: 'scanned' }
>

/**
 * 反复查二维码状态直到有结果；每次状态都交给 onStatus。
 * 状态接口本身是长轮询，这里只在两次之间留一点间隔；signal 取消时以 canceled 结束。
 */
export async function pollLogin(
  poll: () => Promise<Pan115LoginPoll>,
  options: {
    signal: AbortSignal
    onStatus: (status: Pan115LoginPoll['status']) => void
    intervalMs?: number
  }
): Promise<LoginOutcome> {
  const interval = options.intervalMs ?? 1000
  while (!options.signal.aborted) {
    const result = await poll()
    if (options.signal.aborted) break
    options.onStatus(result.status)
    if (result.status !== 'waiting' && result.status !== 'scanned')
      return result
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return { status: 'canceled' }
}

/** 离线任务的状态文字：「下载中 63%」「已完成 · 已入库」「失败」 */
export function offlineStatusLabel(task: OfflineTask): string {
  switch (task.status) {
    case 'waiting':
      return '等待中'
    case 'running':
      return `下载中 ${Math.floor(task.percent)}%`
    case 'done':
      return task.imported ? '已完成 · 已入库' : '已完成 · 等待入库'
    default:
      return '失败'
  }
}

/** 离线任务的说明：大小、保存到的文件夹、添加日期 */
export function offlineMeta(task: OfflineTask): string[] {
  return [
    formatBytes(task.size),
    `存到 ${task.folder || '根目录'}`,
    formatDay(task.addedAt ? new Date(task.addedAt).toISOString() : undefined),
  ].filter(Boolean)
}
