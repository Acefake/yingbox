/**
 * 读取 Kodi / Jellyfin / Emby 风格 NFO 里的条目类型和外部 ID。
 *
 * 只做容错的正则抽取，不做完整 XML 解析：NFO 常见手写、编码混乱或只有一行网址。
 */
import type { ExternalIds } from '../parser'

/** NFO 根元素类型。 */
export type NfoKind = 'movie' | 'tvshow' | 'episodedetails'

/** NFO 中与识别相关的信息。 */
export interface NfoInfo {
  kind?: NfoKind
  ids: ExternalIds
  title?: string
  year?: number
}

const ROOT_RE = /<(movie|tvshow|episodedetails)[\s>]/i
const UNIQUE_ID_RE =
  /<uniqueid\b[^>]*\btype\s*=\s*["']?(tmdb|imdb|tvdb)["']?[^>]*>\s*([^<\s]+)\s*<\/uniqueid>/gi
const LEGACY_TAG_RE =
  /<(tmdbid|tmdb|imdbid|imdb_id|imdb|tvdbid|tvdb)>\s*([^<\s]+)\s*<\/\1>/gi
const LEGACY_ID_RE = /<id>\s*(tt\d{6,9})\s*<\/id>/i
const URL_RES: [keyof ExternalIds, RegExp][] = [
  ['tmdb', /themoviedb\.org\/(?:movie|tv)\/(\d+)/i],
  ['imdb', /imdb\.com\/title\/(tt\d{6,9})/i],
  ['tvdb', /thetvdb\.com\/[^\s"<]*?[?&]id=(\d+)/i],
]
const TITLE_RE = /<title>\s*([^<]+?)\s*<\/title>/i
const YEAR_RE = /<year>\s*(\d{4})\s*<\/year>/i

/** 把各种写法的 ID 统一成 ExternalIds 的格式；不合法返回 undefined。 */
function cleanId(kind: keyof ExternalIds, value: string): string | undefined {
  if (kind === 'imdb')
    return /^tt\d{6,9}$/i.test(value) ? value.toLowerCase() : undefined
  return /^\d+$/.test(value) ? value : undefined
}

function kindOfTag(tag: string): keyof ExternalIds {
  const t = tag.toLowerCase()
  return t.startsWith('imdb') ? 'imdb' : t.startsWith('tvdb') ? 'tvdb' : 'tmdb'
}

/**
 * 解析 NFO 文本。优先级：<uniqueid type=…> > 旧式 <tmdbid>/<imdbid>/<id>tt…</id> > 正文网址。
 */
export function parseNfo(content: string): NfoInfo {
  const ids: ExternalIds = {}
  const put = (kind: keyof ExternalIds, value: string): void => {
    const id = cleanId(kind, value)
    if (id) ids[kind] ??= id
  }
  for (const m of content.matchAll(UNIQUE_ID_RE)) put(kindOfTag(m[1]), m[2])
  for (const m of content.matchAll(LEGACY_TAG_RE)) put(kindOfTag(m[1]), m[2])
  const legacyId = LEGACY_ID_RE.exec(content)
  if (legacyId) put('imdb', legacyId[1])
  for (const [kind, re] of URL_RES) {
    const m = re.exec(content)
    if (m) put(kind, m[1])
  }

  const root = ROOT_RE.exec(content)?.[1].toLowerCase() as NfoKind | undefined
  const title = TITLE_RE.exec(content)?.[1]
  const year = YEAR_RE.exec(content)?.[1]
  return {
    ...(root ? { kind: root } : {}),
    ids,
    ...(title ? { title } : {}),
    ...(year ? { year: Number(year) } : {}),
  }
}
