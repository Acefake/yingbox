/**
 * IPC 边界上观看进度参数的解析。非法时抛 LibraryError（invalid-params）。
 */
import { parseSyncEntry } from '../watch-progress'
import {
  PROGRESS_BATCH_LIMIT,
  type ProgressReport,
  type ProgressRpcMap,
} from './contract-progress'
import { asRecord, invalid, optionalInt, positiveId } from './validate-base'

/** 数组参数：必须是数组、不超过上限。 */
function batch(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) return invalid(`${name} 必须是数组`)
  if (value.length > PROGRESS_BATCH_LIMIT)
    invalid(`${name} 一次最多 ${PROGRESS_BATCH_LIMIT} 条`)
  return value
}

function itemIds(input: unknown): { itemIds: number[] } {
  const r = asRecord(input, '参数')
  const ids = batch(r.itemIds, 'itemIds').map(id => positiveId(id, 'itemIds'))
  return { itemIds: [...new Set(ids)] }
}

const seconds = (value: unknown, name: string): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : invalid(`${name} 必须是不小于 0 的数`)

function parseReport(raw: unknown): ProgressReport {
  const r = asRecord(raw, 'reports[]')
  const report: ProgressReport = {
    itemId: positiveId(r.itemId, 'itemId'),
    position: seconds(r.position, 'position'),
    duration: seconds(r.duration, 'duration'),
  }
  if (r.fileId !== undefined && r.fileId !== null)
    report.fileId = positiveId(r.fileId, 'fileId')
  if (r.ended !== undefined) report.ended = r.ended === true
  if (typeof r.watched === 'boolean') report.watched = r.watched
  else if (r.watched !== undefined) invalid('watched 必须是布尔值')
  if (r.at !== undefined) report.at = seconds(r.at, 'at')
  return report
}

/** 观看进度方法的参数解析器（并入 PARAM_PARSERS）。 */
export const PROGRESS_PARSERS: {
  [M in keyof ProgressRpcMap]: (input: unknown) => ProgressRpcMap[M]['params']
} = {
  'progress.list': itemIds,
  'progress.summary': itemIds,
  'progress.save': input => ({
    reports: batch(asRecord(input, '参数').reports, 'reports').map(parseReport),
  }),
  'progress.recent': input => {
    const limit = optionalInt(asRecord(input, '参数').limit, 'limit', 1)
    return limit === undefined ? {} : { limit: Math.min(limit, 200) }
  },
  'progress.export': input => {
    const since = optionalInt(asRecord(input, '参数').since, 'since', 0)
    return since === undefined ? {} : { since }
  },
  'progress.import': input => {
    const r = asRecord(input, '参数')
    const entries = batch(r.entries, 'entries').map(raw => {
      const entry = parseSyncEntry(raw)
      return entry ?? invalid('entries 里有不合法的条目')
    })
    return { entries, preferIncoming: r.preferIncoming === true }
  },
}
