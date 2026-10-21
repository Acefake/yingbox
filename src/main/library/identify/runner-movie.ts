/**
 * 电影识别：按文件分组识别（同一部片的多个版本解析结果相同，只识别一次）；
 * P2 把同名无年份的不同影片临时合并在一个条目里，这里识别出不同 provider id 时拆成多个条目。
 */
import {
  type IdentifyResult,
  identify,
  parseNfo,
} from '../../../shared/library/identify'
import type { NfoInfo } from '../../../shared/library/identify'
import type { ItemChanges } from '../catalog/catalog-store'
import { transaction } from '../db/database'
import type { IdentifyTarget, TargetFile } from './identify-store'
import {
  type GroupResult,
  groupMovieFiles,
  mergeMatchedByRef,
  pickUndecided,
  stem,
} from './runner-rules'
import type { Outcome, RunnerContext } from './runner-types'

/** 识别一个电影条目：分组识别 → 归并 → 文件最多的匹配留在原条目，其余拆出去。 */
export async function identifyMovie(
  ctx: RunnerContext,
  target: IdentifyTarget,
  changes: ItemChanges,
  signal?: AbortSignal
): Promise<Outcome> {
  const groups = groupMovieFiles(ctx.deps.store.files(target.id))
  if (!groups.length) return ctx.writeUndecided(target, [], changes)

  const results: GroupResult[] = []
  for (const group of groups) {
    results.push({
      files: group,
      result: await identifyMovieFile(ctx, group[0], signal),
    })
  }

  const ordered = mergeMatchedByRef(results)
  if (!ordered.length) {
    // 都没匹配上：取最好的一组候选
    const { state, candidates } = pickUndecided(results)
    return ctx.writeUndecided(target, candidates, changes, state)
  }

  // 文件最多的匹配留在原条目，其余拆出去（同名无年份临时合并的不同影片）
  const [main, ...others] = ordered
  for (const other of others) {
    const newId = transaction(ctx.deps.db, () =>
      ctx.deps.store.splitMovie(
        target,
        other.files.map(f => f.id),
        other.ref,
        ctx.now()
      )
    )
    changes.added.add(newId)
    const split = ctx.deps.store.target(newId)!
    await ctx.applyRef(split, other.ref, 'auto', other.result, changes, signal)
  }
  await ctx.applyRef(target, main.ref, 'auto', main.result, changes, signal)
  return 'matched'
}

/** 识别电影的一个代表文件。 */
async function identifyMovieFile(
  ctx: RunnerContext,
  file: TargetFile,
  signal?: AbortSignal
): Promise<IdentifyResult> {
  const parsed = file.parsed!
  const nfo = await movieNfo(ctx, file)
  const needSearch = !nfo?.ids.tmdb && !nfo?.ids.imdb && !parsed.ids
  const [runtimeMinutes, fileHash] = await Promise.all([
    needSearch ? runtimeOf(ctx, file) : undefined,
    needSearch ? hashOf(ctx, file) : undefined,
  ])
  return identify(
    { parsed, nfo, runtimeMinutes, fileHash },
    {
      provider: ctx.deps.provider,
      hashLookup: ctx.deps.hashLookup?.configured
        ? ctx.deps.hashLookup
        : undefined,
      secondaryLanguage: ctx.deps.provider.secondaryLanguage,
      signal,
    }
  )
}

/** 电影 NFO：同名 .nfo 优先，其次 movie.nfo。 */
async function movieNfo(
  ctx: RunnerContext,
  file: TargetFile
): Promise<NfoInfo | undefined> {
  const nfos = ctx.deps.store.nfoFiles(file.dir)
  if (!nfos.size) return undefined
  const path =
    nfos.get(`${stem(file.name)}.nfo`.toLowerCase()) ?? nfos.get('movie.nfo')
  const text = path ? await ctx.readText(path) : undefined
  return text ? parseNfo(text) : undefined
}

/** 文件时长（分钟）：库里有就用，没有就探测并记下。 */
async function runtimeOf(
  ctx: RunnerContext,
  file: TargetFile
): Promise<number | undefined> {
  let seconds = file.duration ?? undefined
  if (seconds === undefined && ctx.deps.probeDuration) {
    seconds = await ctx.deps.probeDuration(file.displayPath)
    if (seconds !== undefined) ctx.deps.store.setDuration(file.id, seconds)
  }
  return seconds ? Math.round(seconds / 60) : undefined
}

/** 文件哈希：只在配置了 OpenSubtitles 时计算。 */
async function hashOf(
  ctx: RunnerContext,
  file: TargetFile
): Promise<{ hash: string; size: number } | undefined> {
  if (!ctx.deps.hashLookup?.configured) return undefined
  let hash = file.fingerprint ?? undefined
  if (!hash && ctx.deps.fingerprint) {
    hash = await ctx.deps.fingerprint(file.displayPath)
    if (hash) ctx.deps.store.setFingerprint(file.id, hash)
  }
  return hash ? { hash, size: file.size } : undefined
}
