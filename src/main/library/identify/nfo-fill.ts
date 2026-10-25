/**
 * 本地 NFO 的定位与补全：识别链读 NFO 取 ID，识别完再用 NFO 里的类型、制片国家、评分、简介、年份
 * 补空着的字段（TMDB 匹配失败、没配 TMDB 或 TMDB 缺字段时，海报墙的类型筛选 / AI 搜索仍有数据）。
 *
 * - 电影：同名 .nfo 优先，其次 movie.nfo（各文件依次找，第一份为准）；
 * - 剧集：剧集文件夹里的 tvshow.nfo；
 * - 番号库不走这里（番号站点有自己的类型），锁定条目也补（只补空字段，不改匹配）。
 */
import {
  hasNfoDetails,
  parseNfoDetails,
} from '../../../shared/library/identify'
import type { ItemChanges } from '../catalog/catalog-store'
import { transaction } from '../db/database'
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

/** 条目的 NFO 路径：电影取第一个有 NFO 的文件，剧集取 tvshow.nfo。 */
function targetNfoPath(
  store: IdentifyStore,
  target: IdentifyTarget
): string | undefined {
  if (target.type !== 'movie') return seriesNfoPath(store, target)
  for (const file of store.files(target.id)) {
    const path = movieNfoPath(store, file)
    if (path) return path
  }
  return undefined
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
  try {
    return await fillTarget(ctx, target, changes)
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
  const path = targetNfoPath(store, target)
  const text = path ? await ctx.readText(path) : undefined
  if (!text) return false
  const details = parseNfoDetails(text)
  if (!hasNfoDetails(details)) return false
  const changed = transaction(db, () =>
    writer.fillLocal(
      target.id,
      {
        genres: details.genres,
        countries: details.countries,
        rating: details.rating,
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
