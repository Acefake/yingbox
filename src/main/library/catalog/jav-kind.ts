/**
 * 番号类别的 SQL 函数 jav_kind(code)：按归一后的番号（番号库条目存在 tmdb_id 列）判定
 * 有码 / 无码 / FC2 / 素人，供海报墙的「类型」筛选用。判定规则与刮削选站一致（parseJavCode）。
 *
 * 不落库：类别完全由番号决定，规则改了也不用迁移回填；海报墙筛选时按行调用，
 * 几万条以内是毫秒级，结果按番号缓存。
 */
import type { JavKind } from '../../../shared/library/ipc'
import { parseJavCode } from '../providers/jav/number'
import type { LibraryDb } from '../db/database'

/** 番号 → 类别缓存（番号集合有限，不设上限）。 */
const cache = new Map<string, JavKind | null>()

/** 番号的类别；认不出返回 null。 */
export function javKindOf(code: string): JavKind | null {
  let kind = cache.get(code)
  if (kind === undefined) {
    kind = parseJavCode(code)?.kind ?? null
    cache.set(code, kind)
  }
  return kind
}

/** 已注册过的连接。 */
const registered = new WeakSet<LibraryDb>()

/** 在连接上注册 jav_kind(code)；重复调用无副作用。 */
export function registerJavKind(db: LibraryDb): void {
  if (registered.has(db)) return
  db.function('jav_kind', { deterministic: true }, (code: unknown) =>
    code === null || code === undefined ? null : javKindOf(String(code))
  )
  registered.add(db)
}
