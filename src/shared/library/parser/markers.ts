/**
 * 从文件名原文里抽取结构化标记：外部 ID、播出日期、季 / 集。
 *
 * 命中的片段被替换成 SENTINEL，后续分词时它就是片名的终止符。
 */
import { NUMBER_PATTERN, parseNumber } from './cjk'
import type { ExternalIds } from './types'

/** 标记占位符；分词后单独成为一个 marker 词。 */
export const SENTINEL = '\u0001'
const SLOT = ` ${SENTINEL} `

/** 抽取到的标记。 */
interface Markers {
  ids: ExternalIds
  season?: number
  episodes: number[]
  /** 集号来自“裸数字”（动画 ` - 03`），而不是 SxxEyy / EP / 第N集 这类显式写法。 */
  bare: boolean
  airDate?: string
}

const ID_BRACKET_RE =
  /[[{(]\s*(tmdb|tmdbid|themoviedb|imdb|imdbid|tvdb|tvdbid)\s*[-=:_ ]\s*(tt\d{6,9}|\d{1,9})\s*[\]})]/gi
const BARE_IMDB_RE = /(?<![A-Za-z0-9])tt\d{7,8}(?!\d)/g
/** 动画文件名末尾的 CRC32 校验值（[ABCD1234]），里面的 E5 之类会被误认成集号。 */
const CRC_RE = /[[(][0-9A-F]{8}[\])]/gi

const DATE_RE =
  /(?<!\d)((?:19|20)\d{2})[.\-_ ](0[1-9]|1[0-2])[.\-_ ](0[1-9]|[12]\d|3[01])(?!\d)/
const COMPACT_DATE_RE =
  /(?<![\dA-Za-z])((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?![\dA-Za-z])/

const SXXEYY_RE = /(?<![A-Za-z0-9])S(\d{1,3})[\s._-]?E(\d{1,4})(?![\dpi])/i
const SXXEYY_NEXT_RE = /([._\s]?-[._\s]?E?|[._]?E)(\d{1,4})(?![\dpi])/iy
const NXM_RE = /(?<![A-Za-z0-9])(\d{1,2})x(\d{2,3})(?![\dpi])/i
const NXM_NEXT_RE = /(-)(?:\d{1,2}x)?(\d{2,3})(?![\dpi])/iy
const CN_SEASON_RE = new RegExp(`第\\s*(${NUMBER_PATTERN})\\s*季`)
const CN_EPISODE_RE = new RegExp(
  `第\\s*(${NUMBER_PATTERN})(?:\\s*[-~～至到]\\s*(${NUMBER_PATTERN}))?\\s*[集话話回期]`
)
const SEASON_WORD_RE = /(?<![A-Za-z])Season[\s._-]*(\d{1,2})(?!\d)/i
const EPISODE_WORD_RE = /(?<![A-Za-z])Episode[\s._-]*(\d{1,4})(?!\d)/i
const EP_RE =
  /(?<![A-Za-z0-9])EP[\s._-]?(\d{1,4})(?:\s*-\s*(?:EP?)?(\d{1,4}))?(?![A-Za-z0-9])/i
const E_RE = /(?<![A-Za-z0-9])E(\d{1,4})(?:-E?(\d{1,4}))?(?![A-Za-z0-9])/i
const ANIME_DASH_RE = /\s-\s(\d{1,4})(?:v\d)?(?=\s|$|[[(【（])/
/** 字幕组常用的“片名 S2 - 12”：季内集号，不是绝对集数。 */
const ANIME_SEASON_DASH_RE =
  /(?<![A-Za-z0-9])S(\d{1,2})\s-\s(\d{1,4})(?:v\d)?(?=\s|$|[[(【（])/i

/** 闭区间 [from, to]；区间不合理时只返回起点。 */
function range(from: number, to: number | undefined): number[] {
  if (to === undefined || to <= from || to - from > 200) return [from]
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

const isYear = (n: number): boolean => n >= 1900 && n <= 2099

/**
 * 抽取标记并返回替换后的文本。只认第一处季集写法，按可靠程度依次尝试。
 */
export function extractMarkers(input: string): {
  text: string
  markers: Markers
} {
  let text = input
  const markers: Markers = { ids: {}, episodes: [], bare: false }

  text = text.replace(ID_BRACKET_RE, (_, kind: string, value: string) => {
    const k = kind.toLowerCase()
    if (k.startsWith('imdb')) {
      if (/^tt/i.test(value)) markers.ids.imdb = value.toLowerCase()
    } else if (k.startsWith('tvdb')) {
      markers.ids.tvdb = value
    } else if (!/^tt/i.test(value)) {
      markers.ids.tmdb = value
    }
    return ' '
  })
  text = text.replace(CRC_RE, ' ')
  text = text.replace(BARE_IMDB_RE, value => {
    markers.ids.imdb ??= value.toLowerCase()
    return ' '
  })

  const replace = (
    re: RegExp,
    onMatch: (m: RegExpExecArray) => void
  ): boolean => {
    const m = re.exec(text)
    if (!m) return false
    onMatch(m)
    text = text.slice(0, m.index) + SLOT + text.slice(m.index + m[0].length)
    return true
  }

  const date = DATE_RE.exec(text) ?? COMPACT_DATE_RE.exec(text)
  if (date) {
    markers.airDate = `${date[1]}-${date[2]}-${date[3]}`
    text =
      text.slice(0, date.index) + SLOT + text.slice(date.index + date[0].length)
    return { text, markers }
  }

  // SxxEyy 及其多集延续：-E03 / -03 为区间，E02 为单集
  const sxe = SXXEYY_RE.exec(text)
  if (sxe) {
    markers.season = Number(sxe[1])
    const episodes = [Number(sxe[2])]
    let end = sxe.index + sxe[0].length
    SXXEYY_NEXT_RE.lastIndex = end
    let next: RegExpExecArray | null
    while ((next = SXXEYY_NEXT_RE.exec(text))) {
      const n = Number(next[2])
      const last = episodes[episodes.length - 1]
      if (n <= last || n - last > 200) break
      episodes.push(...(next[1].includes('-') ? range(last + 1, n) : [n]))
      end = SXXEYY_NEXT_RE.lastIndex
    }
    markers.episodes = episodes
    text = text.slice(0, sxe.index) + SLOT + text.slice(end)
    return { text, markers }
  }

  const nxm = NXM_RE.exec(text)
  if (nxm) {
    markers.season = Number(nxm[1])
    const first = Number(nxm[2])
    let end = nxm.index + nxm[0].length
    NXM_NEXT_RE.lastIndex = end
    const next = NXM_NEXT_RE.exec(text)
    if (next) end = NXM_NEXT_RE.lastIndex
    markers.episodes = range(first, next ? Number(next[2]) : undefined)
    text = text.slice(0, nxm.index) + SLOT + text.slice(end)
    return { text, markers }
  }

  replace(CN_SEASON_RE, m => (markers.season = parseNumber(m[1])))
  const cnEpisode = replace(CN_EPISODE_RE, m => {
    const from = parseNumber(m[1])
    const to = m[2] === undefined ? undefined : parseNumber(m[2])
    if (from !== undefined) markers.episodes = range(from, to)
  })
  if (cnEpisode || markers.season !== undefined) return { text, markers }

  replace(SEASON_WORD_RE, m => (markers.season = Number(m[1])))
  if (
    replace(EPISODE_WORD_RE, m => (markers.episodes = [Number(m[1])])) ||
    replace(
      EP_RE,
      m =>
        (markers.episodes = range(
          Number(m[1]),
          m[2] === undefined ? undefined : Number(m[2])
        ))
    ) ||
    replace(
      E_RE,
      m =>
        (markers.episodes = range(
          Number(m[1]),
          m[2] === undefined ? undefined : Number(m[2])
        ))
    )
  ) {
    return { text, markers }
  }

  if (
    replace(ANIME_SEASON_DASH_RE, m => {
      markers.season = Number(m[1])
      markers.episodes = [Number(m[2])]
    })
  ) {
    return { text, markers }
  }

  const dash = ANIME_DASH_RE.exec(text)
  if (dash && !isYear(Number(dash[1]))) {
    markers.episodes = [Number(dash[1])]
    markers.bare = true
    text =
      text.slice(0, dash.index) + SLOT + text.slice(dash.index + dash[0].length)
  }
  return { text, markers }
}
