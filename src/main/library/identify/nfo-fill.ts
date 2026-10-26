/**
 * 本地 NFO 的定位与补全：识别链读 NFO 取 ID，识别完再用 NFO 里的类型、制片国家、评分、简介、年份
 * 补空着的字段（TMDB 匹配失败、没配 TMDB 或 TMDB 缺字段时，海报墙的类型筛选 / AI 搜索仍有数据）。
 *
 * - 电影：各文件的同名 .nfo / movie.nfo 依次读，第一份有描述信息的为准（多文件条目不只看第一份）；
 * - 剧集：剧集文件夹里的 tvshow.nfo；
 * - 番号库不走这里（番号站点有自己的类型），锁定条目也补（只补空字段，不改匹配）；
 * - 只有真的写了字段才记进 changes（避免触发无谓的 NFO 写出）；
 * - 没配 TMDB 时条目不会被标成已识别，每次扫描后都会再进识别任务：补过且之后没变化（updated_at 不变）
 *   的条目本进程内不再重读 NFO。
 */
import {
  type NfoDetails,
  hasNfoDetails,
  parseNfoDetails,
} from '../../../shared/library/identify'
import type { ItemChanges } from '../catalog/catalog-store'
import { type LibraryDb, StatementCache, transaction } from '../db/database'
import type {
  IdentifyStore,
  IdentifyTarget,
  TargetFile,
} from './identify-store'
import { seriesFolder, stem } from './runner-rules'
import type { RunnerContext } from './runner-types'

/** 电影文件对应的 NFO 路径：同名 .nfo 优先，其次 movie.nfo。 */
export function movieNfoPath(
  store: IdentifyStore,
  file: Pick<TargetFile, 'dir' | 'name'>
): string | undefined {
  const nfos = store.nfoFiles(file.dir)
  if (!nfos.size) return undefined
  return (
    nfos.get(`${stem(file.name)}.nfo`.toLowerCase()) ?? nfos.get('movie.nfo')
  )
}

/** 剧集条目的 tvshow.nfo 路径（剧集文件夹 = 媒体库根下第一层）。 */
export function seriesNfoPath(
  store: IdentifyStore,
  target: Pick<IdentifyTarget, 'libraryId' | 'localKey'>
): string | undefined {
  const folder = seriesFolder(target.localKey)
  const root = store.libraryRoot(target.libraryId)
  if (!folder || !root) return undefined
  return store.nfoFiles(`${root.rootKey}/${folder}`).get('tvshow.nfo')
}

/** 条目的候选 NFO 路径（去重、按顺序）：电影是各文件对应的 NFO，剧集是 tvshow.nfo。 */
function targetNfoPaths(
  store: IdentifyStore,
  target: IdentifyTarget
): string[] {
  if (target.type !== 'movie') {
    const path = seriesNfoPath(store, target)
    return path ? [path] : []
  }
  const paths = new Set<string>()
  for (const file of store.files(target.id)) {
    const path = movieNfoPath(store, file)
    if (path) paths.add(path)
  }
  return [...paths]
}

/** 每个数据库：没配 TMDB 时补过的条目 id → 当时的 updated_at。 */
const localChecked = new WeakMap<LibraryDb, Map<number, number>>()
const stampSql = new WeakMap<LibraryDb, StatementCache>()

/** 条目当前的 updated_at；条目不在了返回 undefined。 */
function updatedAt(db: LibraryDb, itemId: number): number | undefined {
  let sql = stampSql.get(db)
  if (!sql) stampSql.set(db, (sql = new StatementCache(db)))
  const row = sql
    .get('SELECT updated_at FROM media_items WHERE id = ?')
    .get(itemId)
  return row ? Number(row.updated_at) : undefined
}

/** 没配 TMDB 时的已补记录（配了 TMDB 不去重：条目识别后自然不再进任务）。 */
function checkedFor(ctx: RunnerContext): Map<number, number> | undefined {
  if (ctx.deps.provider.configured) return undefined
  let seen = localChecked.get(ctx.deps.db)
  if (!seen) localChecked.set(ctx.deps.db, (seen = new Map()))
  return seen
}

/**
 * 用 NFO 补一个顶层条目的空字段；有改动时记进 changes。番号库条目、读不到 NFO、
 * NFO 里没有描述信息或字段都已有值时什么也不做；出错只记日志，不影响识别结果。
 */
export async function fillFromNfo(
  ctx: RunnerContext,
  target: IdentifyTarget,
  changes: ItemChanges
): Promise<boolean> {
  if (target.source === 'jav') return false
  const seen = checkedFor(ctx)
  const db = ctx.deps.db
  if (seen && seen.get(target.id) === updatedAt(db, target.id)) return false
  try {
    const changed = await fillTarget(ctx, target, changes)
    const stamp = seen && updatedAt(db, target.id)
    if (seen && stamp !== undefined) seen.set(target.id, stamp)
    return changed
  } catch (error) {
    ctx.deps.log?.(
      `NFO 补全条目 ${target.id} 失败：${(error as Error).message}`
    )
    return false
  }
}

async function fillTarget(
  ctx: RunnerContext,
  target: IdentifyTarget,
  changes: ItemChanges
): Promise<boolean> {
  const { store, writer, db } = ctx.deps
  let details: NfoDetails | undefined
  for (const path of targetNfoPaths(store, target)) {
    const text = await ctx.readText(path)
    const parsed = text ? parseNfoDetails(text) : undefined
    if (parsed && hasNfoDetails(parsed)) {
      details = parsed
      break
    }
  }
  if (!details) return false
  const changed = transaction(db, () =>
    writer.fillLocal(
      target.id,
      {
        genres: details.genres,
        countries: details.countries,
        rating: details.rating,
        ratingSource: details.ratingSource,
        overview: details.plot,
        year: details.year,
      },
      'nfo',
      ctx.now()
    )
  )
  if (changed) changes.touch(target.id)
  return changed
}
