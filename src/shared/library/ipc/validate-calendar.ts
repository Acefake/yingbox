/**
 * IPC 边界上追剧日历参数的解析。非法时抛 LibraryError（invalid-params）。
 */
import {
  CALENDAR_MAX_DAYS,
  type CalendarRequest,
  type CalendarRpcMap,
} from './contract-calendar'
import { asRecord, invalid } from './validate-base'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** YYYY-MM-DD → UTC 零点毫秒；格式或日期本身不对时抛错。 */
function parseDate(value: unknown, name: string): number {
  if (typeof value !== 'string' || !DATE_RE.test(value))
    invalid(`${name} 必须是 YYYY-MM-DD`)
  const time = Date.parse(`${value as string}T00:00:00Z`)
  // 2026-02-30 这类日期会被 Date 进位，转回字符串对不上就是非法
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    invalid(`${name} 不是有效日期`)
  return time
}

function parseCalendarRequest(input: unknown): CalendarRequest {
  const r = asRecord(input, '参数')
  const from = parseDate(r.from, 'from')
  const to = parseDate(r.to, 'to')
  if (to < from) invalid('to 不能早于 from')
  if ((to - from) / DAY_MS + 1 > CALENDAR_MAX_DAYS)
    invalid(`一次最多查 ${CALENDAR_MAX_DAYS} 天`)
  return { from: r.from as string, to: r.to as string }
}

/** 追剧日历方法的参数解析器（并入 PARAM_PARSERS）。 */
export const CALENDAR_PARSERS: {
  [M in keyof CalendarRpcMap]: (input: unknown) => CalendarRpcMap[M]['params']
} = {
  'calendar.episodes': parseCalendarRequest,
}
