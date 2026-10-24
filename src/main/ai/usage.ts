/**
 * AI 用量统计：按月（本地时间）累计服务商返回的 tokens，落盘到 userData/ai/usage.json。
 *
 * - 只记成功的请求；服务商没返回 usage 时只加请求数。
 * - 保留最近 12 个月，更早的丢掉。
 * - 读写经注入的 io，测试用内存实现；主进程用 atomicWrite。
 */
import type {
  AiMonthUsage,
  AiTokenUsage,
  AiUsageSummary,
} from '../../shared/ai/types'

/** 保留几个月 */
const KEEP_MONTHS = 12

/** usage.json 的结构 */
export interface UsageFile {
  version: 1
  months: Record<string, Omit<AiMonthUsage, 'month'>>
}

/** 本地时间的月份键 YYYY-MM */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const emptyMonth = (): Omit<AiMonthUsage, 'month'> => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requests: 0,
})

/** 把磁盘上的未知 JSON 收窄为 UsageFile（不合法的月份丢掉） */
export function parseUsageFile(raw: unknown): UsageFile {
  const file: UsageFile = { version: 1, months: {} }
  const months = (raw as { months?: unknown } | null)?.months
  if (!months || typeof months !== 'object') return file
  for (const [key, value] of Object.entries(
    months as Record<string, unknown>
  )) {
    if (!/^\d{4}-\d{2}$/.test(key) || !value || typeof value !== 'object')
      continue
    const v = value as Record<string, unknown>
    const n = (x: unknown): number =>
      typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0
    file.months[key] = {
      promptTokens: n(v.promptTokens),
      completionTokens: n(v.completionTokens),
      totalTokens: n(v.totalTokens),
      requests: n(v.requests),
    }
  }
  return file
}

/** 累加一次成功请求的用量（返回新对象，并裁掉超过保留期的月份） */
export function addUsage(
  file: UsageFile,
  month: string,
  usage: AiTokenUsage | null
): UsageFile {
  const current = file.months[month] ?? emptyMonth()
  const next = {
    promptTokens: current.promptTokens + (usage?.promptTokens ?? 0),
    completionTokens: current.completionTokens + (usage?.completionTokens ?? 0),
    totalTokens: current.totalTokens + (usage?.totalTokens ?? 0),
    requests: current.requests + 1,
  }
  const months = { ...file.months, [month]: next }
  const keys = Object.keys(months).sort().reverse()
  for (const old of keys.slice(KEEP_MONTHS)) delete months[old]
  return { version: 1, months }
}

/** 用量概览：本月（没有记录时为 0）+ 历史（新到旧，含本月） */
export function summarize(file: UsageFile, month: string): AiUsageSummary {
  const history = Object.keys(file.months)
    .sort()
    .reverse()
    .map(key => ({ month: key, ...file.months[key] }))
  return {
    current: { month, ...(file.months[month] ?? emptyMonth()) },
    history,
  }
}

/** 读写 usage.json 的 io */
export interface UsageIo {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

/** 用量存储：内存为准，写入串行排队；读盘失败按空记录继续 */
export interface UsageStore {
  record(usage: AiTokenUsage | null): Promise<AiUsageSummary>
  summary(): Promise<AiUsageSummary>
}

/** 创建用量存储（首次使用时才读盘） */
export function createUsageStore(
  io: UsageIo,
  now: () => Date = () => new Date()
): UsageStore {
  let file: UsageFile | null = null
  let loading: Promise<void> | null = null
  let writing: Promise<void> = Promise.resolve()
  const load = (): Promise<void> => {
    loading ??= io
      .read()
      .then(text => parseUsageFile(text ? JSON.parse(text) : null))
      .catch(error => {
        console.warn('[ai] 读取用量记录失败，从零开始', error)
        return parseUsageFile(null)
      })
      .then(parsed => {
        file = parsed
      })
    return loading
  }
  return {
    async record(usage) {
      await load()
      // await 之后同步读改写最新状态，并发记录不会互相覆盖
      const month = monthKey(now())
      const next = addUsage(file!, month, usage)
      file = next
      const text = JSON.stringify(next, null, 2)
      writing = writing
        .then(() => io.write(text))
        .catch(error => console.warn('[ai] 写入用量记录失败', error))
      return summarize(next, month)
    },
    async summary() {
      await load()
      return summarize(file!, monthKey(now()))
    },
  }
}
