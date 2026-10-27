/**
 * 网盘搜索词的意图（纯函数，渲染层网盘页与主进程追更共用）：
 * 从「嫁金钗 S01E20」「嫁金钗 第20集」「嫁金钗 EP20」「嫁金钗 第二季」里认出季号 / 集号，
 * 剩下的剧名拿去查 PanSou 和 TMDB。
 *
 * PanSou 按整词组匹配，分享标题常写成「嫁金钗 (2026) S01E20 …」，带集号去搜几乎必然空手；
 * 所以只用剧名搜，集号留给本地在分享标题层排序（episode-hint.ts）、在文件层高亮。
 */
import { NUMBER_PATTERN, parseNumber } from '../library/parser/cjk'

/** 一次搜索的意图 */
export interface SearchIntent {
  /** 发给 PanSou / TMDB 的词：去掉集号、季号和括号里的年份；什么都没剩时为原词 */
  query: string
  /** 写了集号或季号的判为剧集；没写的不猜（null） */
  kind: 'tv' | null
  season?: number
  episode?: number
}

/** 要找的那一集（季号没写时不按季区分） */
export interface EpisodeTarget {
  season?: number
  episode: number
}

const N = NUMBER_PATTERN
/** 词边界：前面不是字母数字 */
const B = '(?<![a-z0-9])'
/** 词边界：后面不是字母数字 */
const A = '(?![a-z0-9])'

/** 季 + 集：S01E20 / S1 E20 / s01ep20 */
const SEASON_EPISODE_RE = new RegExp(
  `${B}s(\\d{1,2})\\s*ep?(\\d{1,4})${A}`,
  'i'
)
/** 只有集：第20集 / 第二十集 / 第20话 / EP20 / E20 / Episode 20 */
const EPISODE_RES = [
  new RegExp(`第\\s*(${N})\\s*[集话話]`),
  new RegExp(`${B}(?:ep|episode)\\s*\\.?\\s*(\\d{1,4})${A}`, 'i'),
  new RegExp(`${B}e(\\d{1,4})${A}`, 'i'),
]
/** 只有季：S02 / Season 2 / 第二季 */
const SEASON_RES = [
  new RegExp(`${B}s(\\d{1,2})${A}`, 'i'),
  new RegExp(`${B}season\\s*(\\d{1,2})${A}`, 'i'),
  new RegExp(`第\\s*(${N})\\s*季`),
]
/** 括号里的年份：(2026) / （2026） / [2026] / 【2026】 */
const YEAR_RE = /[(（[【]\s*(?:19|20)\d{2}\s*[)）\]】]/g
const LINK_RE = /^(magnet:|ed2k:|https?:)/i

/** 把命中的片段换成空格 */
function cut(text: string, m: RegExpExecArray): string {
  return `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
}

/** 去掉命中的片段，返回剩下的文字和捕获的数字 */
function take(text: string, re: RegExp): [string, number | undefined] {
  const m = re.exec(text)
  if (!m) return [text, undefined]
  return [cut(text, m), parseNumber(m[1])]
}

/** 收尾：合并空白，去掉两端的分隔符 */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_.·|/:：、,，]+|[\s\-_.·|/:：、,，]+$/g, '')
    .trim()
}

/**
 * 认出搜索词里的季号 / 集号。磁力、电驴、网址原样返回。
 * @param input 用户输入的搜索词
 */
export function parseSearchIntent(input: string): SearchIntent {
  const raw = input.trim()
  if (!raw || LINK_RE.test(raw)) return { query: raw, kind: null }
  let rest = raw
  let season: number | undefined
  let episode: number | undefined
  const both = SEASON_EPISODE_RE.exec(rest)
  if (both) {
    season = Number(both[1])
    episode = Number(both[2])
    rest = cut(rest, both)
  }
  for (const re of EPISODE_RES) {
    if (episode !== undefined) break
    ;[rest, episode] = take(rest, re)
  }
  for (const re of SEASON_RES) {
    if (season !== undefined) break
    ;[rest, season] = take(rest, re)
  }
  if (season === undefined && episode === undefined)
    return { query: raw, kind: null }
  const query = tidy(rest.replace(YEAR_RE, ' ')) || raw
  const intent: SearchIntent = { query, kind: 'tv' }
  if (season !== undefined) intent.season = season
  if (episode !== undefined) intent.episode = episode
  return intent
}

/** 意图里要找的那一集；没写集号为 null */
export function episodeTargetOf(intent: SearchIntent): EpisodeTarget | null {
  if (intent.episode === undefined) return null
  return intent.season === undefined
    ? { episode: intent.episode }
    : { season: intent.season, episode: intent.episode }
}

/** 给人看的集号：「第 20 集」「第 2 季 第 20 集」 */
export function episodeLabel(target: EpisodeTarget): string {
  const ep = `第 ${target.episode} 集`
  return target.season === undefined ? ep : `第 ${target.season} 季 ${ep}`
}
