/**
 * 剧集识别：在剧集文件夹层识别一次（tvshow.nfo、文件夹名、各集文件名里的剧名都参与），
 * 用本地季 / 集校验候选；匹配后由 applyRef 按 季 / 集 写每季每集的元数据。
 */
import {
  type LocalEpisodes,
  identify,
  parseNfo,
} from '../../../shared/library/identify'
import type { NfoInfo } from '../../../shared/library/identify'
import {
  type ParsedEpisode,
  parseMediaPath,
} from '../../../shared/library/parser'
import type { ItemChanges } from '../catalog/catalog-store'
import { summarizeEpisodes } from './episode-mapping'
import type { IdentifyTarget } from './identify-store'
import { seriesNfoPath } from './nfo-fill'
import { seriesFolder, seriesTitles } from './runner-rules'
import type { Outcome, RunnerContext } from './runner-types'

/** 剧集识别输入：代表集解析 + 文件夹名 / 其他写法 + 本地季集 + tvshow.nfo。 */
async function seriesInput(
  ctx: RunnerContext,
  target: IdentifyTarget
): Promise<{
  parsed: ParsedEpisode
  extraTitles: string[]
  episodes?: LocalEpisodes
  nfo?: NfoInfo
} | null> {
  const { store } = ctx.deps
  const parses = store
    .files(target.id)
    .map(f => f.parsed)
    .filter((p): p is ParsedEpisode => p?.type === 'episode')
  // 剧集文件夹（媒体库根下第一层）
  const folder = seriesFolder(target.localKey)
  const folderParse = folder ? parseMediaPath(`${folder}.mkv`) : undefined
  const titles = seriesTitles(parses, folderParse)
  if (!titles) return null

  let nfo: NfoInfo | undefined
  const path = seriesNfoPath(store, target)
  const text = path ? await ctx.readText(path) : undefined
  if (text) nfo = parseNfo(text)
  return {
    ...titles,
    episodes: summarizeEpisodes(store.children(target.id)),
    nfo,
  }
}

/** 识别一个剧集条目。 */
export async function identifySeries(
  ctx: RunnerContext,
  target: IdentifyTarget,
  changes: ItemChanges,
  signal?: AbortSignal
): Promise<Outcome> {
  const input = await seriesInput(ctx, target)
  if (!input) return ctx.writeUndecided(target, [], changes)
  const result = await identify(input, {
    provider: ctx.deps.provider,
    secondaryLanguage: ctx.deps.provider.secondaryLanguage,
    signal,
  })
  if (result.status === 'matched') {
    await ctx.applyRef(target, result.ref, 'auto', result, changes, signal)
    return 'matched'
  }
  if (result.status === 'skipped') return 'skipped'
  return ctx.writeUndecided(target, result.candidates, changes, result.status)
}
