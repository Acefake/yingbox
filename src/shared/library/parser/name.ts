/**
 * 解析单个名字（文件名去扩展名后，或一个文件夹名），不看路径上下文。
 *
 * 流程：清洗噪音 → 抽标记（ID / 日期 / 季集）→ 分词 → 定位片名结束与年份
 * → 片名之后找附加内容与分段 → 处理开头方括号 → 推断裸数字集号 → 拆中英双标题。
 */
import { hasCjk } from './cjk'
import { extractMarkers } from './markers'
import { type Token, tokenize } from './tokenize'
import type { ExternalIds } from './types'
import {
  SITE_PREFIX_RE,
  TRAILING_NOISE,
  isExtraWord,
  isStrongTag,
} from './vocabulary'

/** 单个名字的解析结果；路径层再把它和文件夹信息合并。 */
export interface NameInfo {
  title: string
  altTitle?: string
  year?: number
  ids: ExternalIds
  season?: number
  episodes: number[]
  /** 集号来自裸数字（` - 03`、`[03]`、`琅琊榜-01`）。 */
  bare: boolean
  airDate?: string
  part?: number
  /** 名字本身带附加内容关键字（sample / trailer / -featurette）。 */
  extra: boolean
  /** 开头有 [字幕组 / 发布组] 方括号。 */
  hasGroup: boolean
  /** 含强发布标记，像一个发布包名（用于判断文件夹名是否比文件名更可信）。 */
  releaseLike: boolean
}

/** 解析选项。 */
export interface ParseNameOptions {
  /** 名字是文件夹名：不从裸数字推断集号（“24” 是剧名，不是第 24 集）。 */
  folder?: boolean
}

type WordToken = Extract<Token, { kind: 'word' }>

/** 年份上限：今年 + 2。更大的四位数（Blade Runner 2049）当作片名。 */
const MAX_YEAR = new Date().getFullYear() + 2
const YEAR_RE = /^(?:19|20)\d{2}$/
const COMPACT_PART_RE = /^(?:cd|dvd|disc|disk|part|pt)(\d{1,2})$/i
const SPACED_PART_WORDS = new Set(['part', 'pt', 'cd', 'disc', 'disk'])
/** 资源站网址：www. 开头，或域名主体里带数字（避免误伤 The.Net）。 */
const URL_RE =
  /(?:https?:\/\/)?(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]*\d[a-z0-9-]*\.(?:com|net|org|cc|xyz|top|vip|cn|la|tv|me))(?![a-z0-9])/gi
/** 片名之后出现的多词附加内容说明（Heat (1995) - Behind the Scenes）。 */
const EXTRA_PHRASE_RE = /\b(?:behind the scenes|deleted scenes?|making of)\b/
/** 片名词序列里的连接符号占位。 */
const DASH = '-'
const SLASH = '/'

const isYearWord = (text: string): boolean =>
  YEAR_RE.test(text) && Number(text) <= MAX_YEAR
const isWord = (t: Token | undefined): t is WordToken => t?.kind === 'word'

/** 片名在第一个强终止符处结束：标记、年份/集号括号、强发布标记、紧凑分段词。 */
function isTerminator(t: Token): boolean {
  if (t.kind === 'marker') return true
  if (t.kind === 'bracket') return t.type === 'year' || t.type === 'number'
  if (t.kind === 'word') {
    return isStrongTag(t.text) || COMPACT_PART_RE.test(t.text)
  }
  return false
}

/**
 * 定位片名结束位置与年份。
 *
 * 终止符是年份括号时直接取它；否则取终止符之前最后一个“前面还有片名词”的年份词
 * （1917.2019 → 片名 1917、年份 2019；1917.1080p → 片名 1917、无年份）。
 */
function locateTitleEnd(tokens: Token[]): { titleEnd: number; year?: number } {
  let firstTerm = tokens.findIndex(isTerminator)
  if (firstTerm < 0) firstTerm = tokens.length
  const term = tokens[firstTerm]
  if (term?.kind === 'bracket' && term.type === 'year') {
    return { titleEnd: firstTerm, year: Number(term.text) }
  }
  for (let i = firstTerm - 1; i > 0; i--) {
    const t = tokens[i]
    if (!isWord(t) || !isYearWord(t.text)) continue
    const hasTitleBefore = tokens
      .slice(0, i)
      .some(p => isWord(p) || (p.kind === 'bracket' && p.type === 'text'))
    if (hasTitleBefore) return { titleEnd: i, year: Number(t.text) }
  }
  return { titleEnd: firstTerm }
}

/** 片名之后：附加内容关键字 / 短语，分段（CD1、part2、Disc 2）。 */
function scanAfterTitle(
  tokens: Token[],
  titleEnd: number
): { extra: boolean; part?: number } {
  let extra = false
  let part: number | undefined
  const tailWords: string[] = []
  for (let i = titleEnd; i < tokens.length; i++) {
    const t = tokens[i]
    if (!isWord(t)) continue
    const lower = t.text.toLowerCase()
    tailWords.push(lower)
    if (isExtraWord(lower)) extra = true
    const compact = COMPACT_PART_RE.exec(lower)
    const next = tokens[i + 1]
    if (compact) {
      part ??= Number(compact[1])
    } else if (
      SPACED_PART_WORDS.has(lower) &&
      isWord(next) &&
      /^\d{1,2}$/.test(next.text)
    ) {
      part ??= Number(next.text)
    }
  }
  if (EXTRA_PHRASE_RE.test(tailWords.join(' '))) extra = true
  return { extra, part }
}

/**
 * 开头的文本方括号是字幕组，还是片名：
 * - 括号外还有片名词：括号是中日韩文、不像组名、括号外没有中日韩文时是中文片名
 *   （[流浪地球].The.Wandering.Earth），否则是组名；
 * - 括号外没有片名词：全是方括号的动画命名，第一个是组名、第二个是片名。
 */
function resolveLeadBracket(
  tokens: Token[],
  titleTokens: Token[]
): { leadTitle?: string; hasGroup: boolean } {
  const lead = tokens[0]
  if (lead?.kind !== 'bracket' || lead.type !== 'text')
    return { hasGroup: false }
  const outside = titleTokens.filter(isWord)
  if (outside.length) {
    const isCjkTitle =
      hasCjk(lead.text) && !lead.group && !outside.some(w => hasCjk(w.text))
    return isCjkTitle
      ? { leadTitle: lead.text, hasGroup: false }
      : { hasGroup: true }
  }
  const texts = tokens.filter(
    (t): t is Extract<Token, { kind: 'bracket' }> =>
      t.kind === 'bracket' && t.type === 'text'
  )
  return texts.length >= 2
    ? { leadTitle: texts[1].text, hasGroup: true }
    : { leadTitle: lead.text, hasGroup: false }
}

/**
 * 没有显式集号时，从裸数字推断集号：`[03]`、`甄嬛传 76`、`琅琊榜-01`、`03.mkv`。
 * 拉丁片名末尾的数字（Toy Story 3）只在有字幕组方括号时才算集号。
 * 返回去掉集号后的片名词。
 */
function inferBareEpisode(
  tokens: Token[],
  words: string[],
  hasGroup: boolean
): { episode?: number; words: string[] } {
  const real = words.filter(w => w !== DASH && w !== SLASH)
  const last = real[real.length - 1]
  const rest = real.slice(0, -1)
  const animeLike = (text: string): boolean => hasGroup || hasCjk(text)

  const numberBracket = tokens.find(
    t => t.kind === 'bracket' && t.type === 'number'
  )
  if (numberBracket?.kind === 'bracket' && animeLike(real.join(''))) {
    return { episode: parseInt(numberBracket.text, 10), words }
  }
  if (tokens.length === 1 && real.length === 1 && /^\d{1,3}$/.test(last)) {
    return { episode: Number(last), words: [] }
  }
  if (
    last !== undefined &&
    rest.length &&
    /^\d{1,4}$/.test(last) &&
    !isYearWord(last) &&
    animeLike(rest.join(''))
  ) {
    return {
      episode: Number(last),
      words: words.slice(0, words.lastIndexOf(last)),
    }
  }
  return { words }
}

/**
 * 把片名词按“中日韩 / 拉丁”拆成主副标题；只有两边都有时才拆。
 *
 * 独立的多位数字词（斯巴达300勇士.300、龙虎少年队.21.Jump.Street）归拉丁一侧；
 * 一位数字跟随前一个词（流浪地球 2 视为续集号）。
 */
function splitDualTitle(words: string[]): { cjk: string[]; latin: string[] } {
  const cjk: string[] = []
  const latin: string[] = []
  let side: string[] | undefined
  for (const w of words) {
    if (hasCjk(w)) side = cjk
    else if (/[A-Za-z]/.test(w) || /^\d{2,}$/.test(w)) side = latin
    ;(side ?? latin).push(w)
  }
  return { cjk, latin }
}

/** 去掉首尾的连接符和标点，折叠空白。 */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_.,;:~·+&]+|[\s\-–—_.,;:~·+&]+$/g, '')
}

/** 收尾：剥掉末尾弱噪音与首尾连接符，再拆中英双标题。 */
function finishTitle(words: string[]): { title: string; altTitle?: string } {
  const w = [...words]
  const isEdgeNoise = (x: string): boolean =>
    x === DASH || x === SLASH || TRAILING_NOISE.has(x.toLowerCase())
  while (w.length && isEdgeNoise(w[w.length - 1])) w.pop()
  while (w.length && (w[0] === DASH || w[0] === SLASH)) w.shift()

  const { cjk, latin } = splitDualTitle(
    w.filter(x => x !== DASH && x !== SLASH)
  )
  if (cjk.length && latin.some(x => /[A-Za-z]|^\d{2,}$/.test(x))) {
    return { title: tidy(cjk.join(' ')), altTitle: tidy(latin.join(' ')) }
  }
  return { title: tidy(w.filter(x => x !== SLASH).join(' ')) }
}

/** 解析一个名字。 */
export function parseName(
  raw: string,
  options: ParseNameOptions = {}
): NameInfo {
  const cleaned = raw
    .replace(/★[^★]*★/g, ' ')
    .replace(URL_RE, ' ')
    .trim()
    .replace(SITE_PREFIX_RE, ' ')
    .replace(/\bH\.(26[45])\b/gi, 'H$1')
  const { text, markers } = extractMarkers(cleaned)
  const tokens = tokenize(text)

  const { titleEnd, year } = locateTitleEnd(tokens)
  const after = scanAfterTitle(tokens, titleEnd)
  let extra = after.extra

  let titleTokens = tokens.slice(0, titleEnd)
  const lastToken = tokens[tokens.length - 1]
  if (
    titleTokens.length > 1 &&
    titleTokens[titleTokens.length - 1] === lastToken &&
    isWord(lastToken) &&
    isExtraWord(lastToken.text)
  ) {
    // 名字以附加内容关键字收尾（Movie.sample），关键字不算片名
    extra = true
    titleTokens = titleTokens.slice(0, -1)
  }

  const { leadTitle, hasGroup } = resolveLeadBracket(tokens, titleTokens)
  let words = titleTokens.flatMap(t =>
    t.kind === 'word'
      ? [t.text]
      : t.kind === 'dash'
        ? [DASH]
        : t.kind === 'slash'
          ? [SLASH]
          : []
  )
  if (leadTitle !== undefined) words = [...leadTitle.split(/\s+/), ...words]

  let episodes = markers.episodes
  let bare = markers.bare
  if (
    !options.folder &&
    !episodes.length &&
    !markers.airDate &&
    year === undefined
  ) {
    const inferred = inferBareEpisode(tokens, words, hasGroup)
    if (inferred.episode !== undefined) {
      episodes = [inferred.episode]
      bare = true
      words = inferred.words
    }
  }

  const { title, altTitle } = finishTitle(words)
  return {
    title,
    ...(altTitle ? { altTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    ids: markers.ids,
    ...(markers.season !== undefined ? { season: markers.season } : {}),
    episodes,
    bare,
    ...(markers.airDate ? { airDate: markers.airDate } : {}),
    ...(after.part !== undefined ? { part: after.part } : {}),
    extra,
    hasGroup,
    releaseLike: tokens.some(t => isWord(t) && isStrongTag(t.text)),
  }
}
