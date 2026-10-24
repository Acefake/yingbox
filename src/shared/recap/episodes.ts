/**
 * 前情提要的剧集与素材规则（纯函数）：同目录里认出「之前几集」、挑外挂字幕、读 NFO 分集简介。
 * 集号解析复用媒体库的文件名解析器（shared/library/parser），与媒体库识别结果一致。
 */
import { parseNfo } from '../library/identify/nfo'
import { parseMediaPath } from '../library/parser'
import type { RecapEpisodeRef } from './types'

/** 同目录里的一集视频 */
export interface EpisodeFile extends RecapEpisodeRef {
  /** 视频绝对路径 */
  path: string
  /** 剧名（解析结果） */
  show: string
}

/** 视频扩展名（与媒体库扫描一致） */
export const RECAP_VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp4',
  '.avi',
  '.mkv',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.ts',
  '.rmvb',
])

/** 小写扩展名（含点）；没有时为空串 */
export function extOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** 去掉扩展名的文件名 */
export function stemOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 集的显示名：有季号用 S01E03，否则「第 3 集」 */
export function episodeLabel(
  season: number | undefined,
  episode: number
): string {
  if (season === undefined) return `第 ${episode} 集`
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `S${pad(season)}E${pad(episode)}`
}

/** 解析一个视频文件是第几集；不是剧集（电影、附加内容、按日期编号）时返回 null */
export function episodeOf(path: string): EpisodeFile | null {
  if (!RECAP_VIDEO_EXTS.has(extOf(path))) return null
  const parsed = parseMediaPath(path.replace(/\\/g, '/'))
  if (parsed.type !== 'episode' || !parsed.episodes.length) return null
  // 季号 0 是特别篇，不参与前情提要
  if (parsed.season === 0) return null
  const episode = parsed.episodes[0]
  return {
    path,
    show: parsed.title,
    episode,
    ...(parsed.season === undefined ? {} : { season: parsed.season }),
    label: episodeLabel(parsed.season, episode),
  }
}

/** 季号比较：没写季号的按第 1 季算（「第 3 集」与「S01E03」同季） */
const seasonOf = (file: EpisodeFile): number => file.season ?? 1

/**
 * 同目录里当前集之前的几集（旧 → 新，最多 max 集）：同一季、集号更小、离当前集最近。
 * 同一集有多个版本时取路径排序第一个。
 */
export function previousEpisodes(
  current: EpisodeFile,
  siblings: readonly EpisodeFile[],
  max: number
): EpisodeFile[] {
  const byEpisode = new Map<number, EpisodeFile>()
  const sorted = [...siblings].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of sorted) {
    if (file.path === current.path) continue
    if (seasonOf(file) !== seasonOf(current)) continue
    if (file.episode >= current.episode) continue
    if (!byEpisode.has(file.episode)) byEpisode.set(file.episode, file)
  }
  return [...byEpisode.values()]
    .sort((a, b) => b.episode - a.episode)
    .slice(0, Math.max(0, max))
    .reverse()
}

/** 中文字幕的语言标记 */
const ZH_TAG =
  /^(zh|chs|cht|sc|tc|chi|zho|cn|gb|big5|简|繁|简体|繁体|中文|简中|繁中|zh-cn|zh-tw|zh-hans|zh-hant)$/i
/** 英文字幕的语言标记 */
const EN_TAG = /^(en|eng|english|英文|英)$/i

/**
 * 在同目录文件名里挑这集的外挂 srt：中文优先，其次英文，再其次同名无语言标记的。
 * 只认与视频同名或以「视频名.」开头的 .srt；别的语言（日文等）不用。
 */
export function pickSidecarSrt(
  videoPath: string,
  names: readonly string[]
): string | null {
  const stem = stemOf(videoPath).toLowerCase()
  let best: { name: string; rank: number } | null = null
  for (const name of names) {
    if (extOf(name) !== '.srt') continue
    const base = stemOf(name).toLowerCase()
    let rank: number
    if (base === stem) rank = 2
    else if (base.startsWith(`${stem}.`)) {
      const tags = base.slice(stem.length + 1).split('.')
      if (tags.some(tag => ZH_TAG.test(tag))) rank = 0
      else if (tags.some(tag => EN_TAG.test(tag))) rank = 1
      else if (tags.every(tag => /^(ai|default|forced|\d+)$/.test(tag)))
        rank = 2
      else continue
    } else continue
    if (
      !best ||
      rank < best.rank ||
      (rank === best.rank && name.length < best.name.length)
    )
      best = { name, rank }
  }
  return best?.name ?? null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 读 NFO 里的 <plot>（容忍 CDATA、实体与多余空白）；没有或为空时返回 null */
export function nfoPlot(content: string): string | null {
  const match = /<plot>([\s\S]*?)<\/plot>/i.exec(content)
  if (!match) return null
  const text = match[1]
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? all
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : all
    })
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** tvshow.nfo 里的 TMDB 剧集 id；没有时返回 null */
export function tvshowTmdbId(content: string): string | null {
  const info = parseNfo(content)
  if (info.kind && info.kind !== 'tvshow') return null
  return info.ids.tmdb ?? null
}
