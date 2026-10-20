/**
 * 剧集本地集 → 元数据源里的（季, 集）。
 *
 * - 有季号的集按 季 / 集 直接对应（特别篇是第 0 季）；
 * - 绝对集数（没有季号）按绝对顺序表映射：第 n 集 → order[n-1]；
 * - 没有集号的（按日期编号、无法解析的）不映射。
 * 另外汇总本地集信息，供整部剧识别时校验季 / 集是否存在。
 */
import type { LocalEpisodes } from '../../../shared/library/identify'
import type { EpisodePosition } from '../../../shared/library/provider'
import type { ChildItem } from './identify-store'

/** 一集的映射结果。 */
export interface EpisodeMapping {
  itemId: number
  position: EpisodePosition
  /** 由绝对集数换算而来。 */
  mapped: boolean
}

/** 本地是否有绝对集数的集（需要绝对顺序表）。 */
export const hasAbsolute = (children: ChildItem[]): boolean =>
  children.some(
    c => c.type === 'episode' && c.season === null && c.episode !== null
  )

/** 计算每个本地集对应的（季, 集）；映射不了的不出现在结果里。 */
export function mapEpisodes(
  children: ChildItem[],
  absoluteOrder: EpisodePosition[] = []
): EpisodeMapping[] {
  const out: EpisodeMapping[] = []
  for (const c of children) {
    if (c.type !== 'episode' || c.episode === null) continue
    if (c.season !== null) {
      out.push({
        itemId: c.id,
        position: { season: c.season, episode: c.episode },
        mapped: false,
      })
      continue
    }
    const position = absoluteOrder[c.episode - 1]
    if (position) out.push({ itemId: c.id, position, mapped: true })
  }
  return out
}

/**
 * 整部剧的本地集摘要（识别打分用）：
 * 有季号时取正片集数最多的一季（不看特别篇，特别篇编号常与 TMDB 对不上）；
 * 全是绝对集数时给出全部集号并标记 absolute。
 */
export function summarizeEpisodes(
  children: ChildItem[]
): LocalEpisodes | undefined {
  const bySeason = new Map<number, number[]>()
  const absolute: number[] = []
  for (const c of children) {
    if (c.type !== 'episode' || c.episode === null) continue
    if (c.season === null) absolute.push(c.episode)
    else if (c.season > 0) {
      const list = bySeason.get(c.season)
      if (list) list.push(c.episode)
      else bySeason.set(c.season, [c.episode])
    }
  }
  let best: [number, number[]] | undefined
  for (const entry of bySeason) {
    if (!best || entry[1].length > best[1].length) best = entry
  }
  if (best) return { season: best[0], episodes: best[1].sort((a, b) => a - b) }
  if (absolute.length) {
    return { episodes: absolute.sort((a, b) => a - b), absolute: true }
  }
  return undefined
}
