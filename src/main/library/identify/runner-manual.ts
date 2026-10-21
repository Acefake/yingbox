/**
 * 手动匹配：指定 id 时直接应用（默认锁定）；
 * 给搜索词时按该词重新识别，够自信自动应用，否则保存并返回候选。
 */
import { identify } from '../../../shared/library/identify'
import { LibraryError } from '../../../shared/library/ipc'
import type { ApplyMatchRequest } from '../../../shared/library/ipc'
import type { MediaRef } from '../../../shared/library/provider'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import { ItemChanges } from '../catalog/catalog-store'
import { transaction } from '../db/database'
import { summarizeEpisodes } from './episode-mapping'
import type { IdentifyTarget } from './identify-store'
import { manualParsed } from './runner-rules'
import type { RunnerContext } from './runner-types'

/** 手动匹配的结果。 */
export interface ManualMatchResult {
  status: 'matched' | 'review' | 'unmatched'
  candidates: ScoredCandidate[]
  changes: ItemChanges
}

/** 手动匹配一个顶层条目。 */
export async function applyManualMatch(
  ctx: RunnerContext,
  target: IdentifyTarget,
  request: ApplyMatchRequest,
  signal?: AbortSignal
): Promise<ManualMatchResult> {
  const { provider } = ctx.deps
  const kind = target.type === 'movie' ? 'movie' : 'tv'
  const changes = new ItemChanges()
  const state = request.lock === false ? 'auto' : 'locked'

  let ref: MediaRef | undefined
  if (request.tmdbId) {
    const hit = await provider.details(kind, request.tmdbId, signal)
    ref = hit?.ref
  } else if (request.imdbId || request.tvdbId) {
    const source = request.imdbId ? 'imdb' : 'tvdb'
    const hits = await provider.find(
      source,
      (request.imdbId ?? request.tvdbId)!,
      signal
    )
    ref = hits.find(c => c.ref.kind === kind)?.ref
  }
  if (ref) {
    // 手动指定前先解除锁定状态的限制：用户的选择覆盖之前的锁定
    await ctx.applyRef(
      { ...target, matchState: 'unmatched' },
      ref,
      state,
      undefined,
      changes,
      signal
    )
    if (state === 'auto') {
      transaction(ctx.deps.db, () =>
        ctx.deps.store.setMatchState(target.id, 'auto', ctx.now())
      )
    }
    return { status: 'matched', candidates: [], changes }
  }
  if (!request.query) {
    throw new LibraryError('not-found', '在 TMDB 上找不到指定的 ID')
  }

  // 按用户给的标题重新识别
  const episodes =
    kind === 'tv'
      ? summarizeEpisodes(ctx.deps.store.children(target.id))
      : undefined
  const result = await identify(
    { parsed: manualParsed(kind, request.query), episodes },
    {
      provider,
      secondaryLanguage: provider.secondaryLanguage,
      signal,
    }
  )
  if (result.status === 'matched') {
    await ctx.applyRef(
      { ...target, matchState: 'unmatched' },
      result.ref,
      'auto',
      result,
      changes,
      signal
    )
    if (target.matchState === 'locked') {
      transaction(ctx.deps.db, () =>
        ctx.deps.store.setMatchState(target.id, 'auto', ctx.now())
      )
    }
    return { status: 'matched', candidates: [], changes }
  }
  if (result.status === 'skipped') {
    return { status: 'unmatched', candidates: [], changes }
  }
  // 用户主动搜索：结果当作候选保存，不动锁定状态之外的匹配
  if (target.matchState !== 'locked') {
    ctx.writeUndecided(target, result.candidates, changes, result.status)
  }
  return { status: result.status, candidates: result.candidates, changes }
}
