/**
 * 识别执行器的纯规则：文件分组、按匹配结果归并、挑候选、剧名代表写法、手动搜索的解析结果。
 *
 * 都不碰数据库与网络，供 identify-runner / runner-movie / runner-series / runner-manual 共用并单测。
 */
import { readFile } from 'node:fs/promises'
import type { IdentifyResult } from '../../../shared/library/identify'
import type { ParsedEpisode, ParsedMedia } from '../../../shared/library/parser'
import type { MediaRef } from '../../../shared/library/provider'
import {
  type ScoredCandidate,
  normalizeTitle,
} from '../../../shared/library/scoring'
import type { IdentifyTarget, TargetFile } from './identify-store'
import type { RunMode } from './runner-types'

/** NFO 最大读取字节。 */
export const NFO_MAX_BYTES = 1024 * 1024

/** 默认的 NFO 读取：超过 1MB 或读不到返回 undefined。 */
export async function defaultReadText(
  path: string
): Promise<string | undefined> {
  try {
    const buffer = await readFile(path)
    if (buffer.length > NFO_MAX_BYTES) return undefined
    return buffer.toString('utf8')
  } catch {
    return undefined
  }
}

/** 去掉扩展名。 */
export const stem = (name: string): string => name.replace(/\.[^.]+$/, '')

/**
 * 文件分组键：同一目录下解析结果相同（忽略分段号）的文件一起识别——同一部片的多个版本 / 分段。
 * 不同目录的同名无年份文件可能是不同影片（P2 临时合并的情况），各自识别。
 */
export function groupKey(file: TargetFile): string {
  const p = file.parsed!
  return JSON.stringify([file.dir, p.title, p.altTitle, p.year, p.ids])
}

/** 匹配结果的归并键。 */
export const refKey = (ref: MediaRef): string => `${ref.kind}:${ref.id}`

/** 电影文件按 groupKey 分组；没解析结果的、花絮跳过。保持首次出现的顺序。 */
export function groupMovieFiles(files: TargetFile[]): TargetFile[][] {
  const groups = new Map<string, TargetFile[]>()
  for (const f of files) {
    if (!f.parsed || f.parsed.type === 'extra') continue
    const key = groupKey(f)
    const list = groups.get(key)
    if (list) list.push(f)
    else groups.set(key, [f])
  }
  return [...groups.values()]
}

/** 一组文件的识别结果。 */
export interface GroupResult {
  files: TargetFile[]
  result: IdentifyResult
}

/** 匹配到同一条目的文件归并后的结果。 */
export interface MatchedGroup {
  ref: MediaRef
  files: TargetFile[]
  result: IdentifyResult
}

/**
 * 按匹配到的条目归并文件，文件多的排前面（第一个留在原条目，其余拆出去）。
 * 排序稳定：文件数相同时保持首次匹配的顺序。
 */
export function mergeMatchedByRef(results: GroupResult[]): MatchedGroup[] {
  const byRef = new Map<string, MatchedGroup>()
  for (const r of results) {
    if (r.result.status !== 'matched') continue
    const key = refKey(r.result.ref)
    const entry = byRef.get(key)
    if (entry) entry.files.push(...r.files)
    else
      byRef.set(key, {
        ref: r.result.ref,
        files: [...r.files],
        result: r.result,
      })
  }
  return [...byRef.values()].sort((a, b) => b.files.length - a.files.length)
}

/**
 * 都没匹配上时挑一组候选：有待确认的取第一个待确认，否则取第一组。
 * results 不能为空。
 */
export function pickUndecided(results: GroupResult[]): {
  state: 'review' | 'unmatched'
  candidates: ScoredCandidate[]
} {
  const best =
    results.map(r => r.result).find(r => r.status === 'review') ??
    results[0].result
  const candidates =
    best.status === 'review' || best.status === 'unmatched'
      ? best.candidates
      : []
  return {
    state: best.status === 'review' ? 'review' : 'unmatched',
    candidates,
  }
}

/** 剧集文件夹名：localKey 形如 `series:<库>:d:<文件夹>`，其他形式返回 undefined。 */
export function seriesFolder(localKey: string): string | undefined {
  return /^series:\d+:d:(.+)$/.exec(localKey)?.[1]
}

/**
 * 剧名代表写法：各集里出现次数最多的写法作代表（相同次数取先出现的），
 * 没有可用的集时退回文件夹名的解析结果；文件名没写年份 / ID 时用文件夹里的。
 * extraTitles 是文件夹名、别名和次多的两种写法，供识别时一起搜。
 *
 * @param parses 各集文件的解析结果（只含 episode）
 * @param folderParse 文件夹名按 `<文件夹>.mkv` 解析的结果
 */
export function seriesTitles(
  parses: ParsedEpisode[],
  folderParse: ParsedMedia | undefined
): { parsed: ParsedEpisode; extraTitles: string[] } | null {
  const counts = new Map<string, { n: number; parsed: ParsedEpisode }>()
  for (const p of parses) {
    const key = normalizeTitle(p.title || p.altTitle || '')
    if (!key) continue
    const entry = counts.get(key)
    if (entry) entry.n++
    else counts.set(key, { n: 1, parsed: p })
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n)
  let parsed: ParsedEpisode | undefined = ranked[0]?.parsed
  if (!parsed && folderParse && folderParse.type !== 'extra') {
    parsed = {
      type: 'episode',
      title: folderParse.title,
      altTitle: folderParse.altTitle,
      year: folderParse.year,
      ids: folderParse.ids,
      episodes: [],
    }
  }
  if (!parsed) return null
  parsed = {
    ...parsed,
    year: parsed.year ?? folderParse?.year,
    ids: parsed.ids ?? folderParse?.ids,
  }
  const extraTitles = [
    folderParse?.title,
    folderParse?.altTitle,
    ...ranked.slice(1, 3).map(r => r.parsed.title),
  ].filter((t): t is string => Boolean(t))
  return { parsed, extraTitles }
}

/**
 * 已有匹配时直接沿用的引用：刷新模式、已锁定、或识别模式下已自动匹配的条目，
 * 只重拉 / 补元数据，不重新识别。其余返回 null。
 */
export function reusableRef(
  target: Pick<IdentifyTarget, 'tmdbId' | 'matchState' | 'type'> &
    Partial<Pick<IdentifyTarget, 'source'>>,
  mode: RunMode
): { ref: MediaRef; state: 'auto' | 'locked' } | null {
  if (
    !target.tmdbId ||
    !(
      mode === 'refresh' ||
      target.matchState === 'locked' ||
      (mode === 'identify' && target.matchState === 'auto')
    )
  ) {
    return null
  }
  return {
    ref: {
      provider: target.source === 'jav' ? 'jav' : 'tmdb',
      kind: target.type === 'movie' ? 'movie' : 'tv',
      id: target.tmdbId,
    },
    state: target.matchState === 'locked' ? 'locked' : 'auto',
  }
}

/** 手动搜索时按用户给的标题 / 年份构造解析结果。 */
export function manualParsed(
  kind: 'movie' | 'tv',
  query: { title: string; year?: number }
): ParsedMedia {
  return kind === 'movie'
    ? { type: 'movie', title: query.title, year: query.year }
    : {
        type: 'episode',
        title: query.title,
        year: query.year,
        episodes: [],
      }
}

/** 批量执行的并发数：默认 8，至少 1，不超过条目数。 */
export function workerCount(
  concurrency: number | undefined,
  total: number
): number {
  return Math.max(1, Math.min(concurrency ?? 8, total))
}
