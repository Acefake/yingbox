/**
 * 黄金集比较规则。
 *
 * 片名比较忽略大小写并折叠空白（大小写对搜索无影响）；其余字段逐一严格相等。
 * extra 只比较类型、所属作品的片名和年份。
 */
import type { GoldenExpected, GoldenIds } from './types'

/** 不一致的字段及其双方取值。 */
export interface FieldMismatch {
  field: string
  expected: unknown
  actual: unknown
}

/** 被比较的解析结果：字段与期望值同名即可。 */
export type ComparableParse = Partial<Omit<GoldenExpected, 'type'>> & {
  type: string
}

const normTitle = (s: string | undefined): string | undefined =>
  s === undefined ? undefined : s.toLowerCase().replace(/\s+/g, ' ').trim()

const normIds = (ids: GoldenIds | undefined): string =>
  JSON.stringify(
    Object.entries(ids ?? {})
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  )

/** 比较一次解析结果与期望值，返回所有不一致字段（空数组表示完全正确）。 */
export function compareParse(
  actual: ComparableParse,
  expected: GoldenExpected
): FieldMismatch[] {
  const out: FieldMismatch[] = []
  const check = (field: string, e: unknown, a: unknown): void => {
    if (e !== a) out.push({ field, expected: e, actual: a })
  }

  check('type', expected.type, actual.type)
  check('title', normTitle(expected.title), normTitle(actual.title))
  check('year', expected.year, actual.year)
  if (expected.type === 'extra') return out

  check('altTitle', normTitle(expected.altTitle), normTitle(actual.altTitle))
  check('season', expected.season, actual.season)
  check(
    'episodes',
    JSON.stringify(expected.episodes ?? []),
    JSON.stringify(actual.episodes ?? [])
  )
  check('absolute', expected.absolute ?? false, actual.absolute ?? false)
  check('part', expected.part, actual.part)
  check('airDate', expected.airDate, actual.airDate)
  check('ids', normIds(expected.ids), normIds(actual.ids))
  return out
}
