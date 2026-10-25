/**
 * 新入库判定的纯规则：哪些新条目可以宣布了、游标怎么往前走。
 *
 * 游标 = 时间水位 since + 水位之后已宣布过的条目。每轮只看 added_at > since 的电影 / 集：
 * - 可宣布：顶层条目在这个条目入库之后识别过（identified_at ≥ added_at）、库没开自动识别，
 *   或入库已满 {@link ARRIVAL_GRACE_MS}（识别迟迟不来时也照常宣布，用文件名解析的片名）；
 * - 还要等：其余的。水位停在最早一个还要等的条目之前，已宣布的记进 announced，同一条目只宣布一次；
 * - 没有要等的：水位推到这一轮最新的入库时间，announced 里水位之前的清掉。
 * 第一次运行（没有游标）水位取当前时间：打开功能之前就在库里的不宣布。
 */

/** 识别迟迟不来时，入库多久后照常宣布。 */
export const ARRIVAL_GRACE_MS = 10 * 60_000

/** 一条候选（电影或集，带顶层条目的识别状态）。 */
export interface ArrivalRow {
  itemId: number
  libraryId: number
  addedAt: number
  /** 顶层条目最近一次识别时间；没识别过为 null。 */
  identifiedAt: number | null
}

/** 游标（持久化）。 */
export interface ArrivalCursor {
  since: number
  /** 水位之后已宣布的条目：[条目 id, 入库时间]。 */
  announced: Array<[number, number]>
}

/** 一轮的结果。 */
export interface ArrivalPlan<T extends ArrivalRow> {
  ready: T[]
  cursor: ArrivalCursor
  /** 还有要等的条目时，最早什么时候到宽限期（再扫一轮）；没有为 null。 */
  recheckAt: number | null
}

/** 解析持久化的游标；坏数据或没有时从 now 开始。 */
export function parseCursor(
  raw: string | undefined,
  now: number
): ArrivalCursor {
  try {
    const value = JSON.parse(raw ?? '') as Partial<ArrivalCursor>
    if (typeof value.since !== 'number' || !Number.isFinite(value.since))
      throw new Error('bad cursor')
    const announced = Array.isArray(value.announced)
      ? value.announced.filter(
          (pair): pair is [number, number] =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every(n => typeof n === 'number' && Number.isFinite(n))
        )
      : []
    return { since: value.since, announced }
  } catch {
    return { since: now, announced: [] }
  }
}

/**
 * 算一轮：rows 是 added_at > cursor.since 的候选（任意顺序）。
 * @param autoIdentify 这个库开没开自动识别
 */
export function planArrivals<T extends ArrivalRow>(
  rows: readonly T[],
  cursor: ArrivalCursor,
  now: number,
  autoIdentify: (libraryId: number) => boolean
): ArrivalPlan<T> {
  const seen = new Set(cursor.announced.map(([id]) => id))
  const isReady = (row: T): boolean =>
    !autoIdentify(row.libraryId) ||
    (row.identifiedAt !== null && row.identifiedAt >= row.addedAt) ||
    now - row.addedAt >= ARRIVAL_GRACE_MS
  const ready: T[] = []
  const waiting: T[] = []
  for (const row of rows) {
    if (seen.has(row.itemId)) continue
    if (isReady(row)) ready.push(row)
    else waiting.push(row)
  }
  ready.sort((a, b) => a.addedAt - b.addedAt || a.itemId - b.itemId)
  const announced: Array<[number, number]> = [
    ...cursor.announced,
    ...ready.map((row): [number, number] => [row.itemId, row.addedAt]),
  ]
  const latest = Math.max(cursor.since, ...rows.map(row => row.addedAt))
  const since = waiting.length
    ? Math.max(cursor.since, Math.min(...waiting.map(r => r.addedAt)) - 1)
    : latest
  return {
    ready,
    cursor: { since, announced: announced.filter(([, at]) => at > since) },
    recheckAt: waiting.length
      ? Math.min(...waiting.map(r => r.addedAt)) + ARRIVAL_GRACE_MS
      : null,
  }
}
