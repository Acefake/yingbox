import { escapeXml } from '@/utils/xml'
import type { ScrapedMovie, CastMember } from '@/types/scraping'
import { getImageBaseUrl } from '@/api/tmdb'

/**
 * 统一的 NFO 数据结构
 * 从 XML 文件解析而来，也可用于生成 XML
 */
export interface NfoData {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  outline?: string
  runtime?: string
  genres?: string[]
  directors?: string[]
  actors?: NfoActor[]
  countries?: string[]
  studios?: string[]
  rating?: string
  votes?: string
  poster?: string
  backdrop?: string
  tmdbid?: string
  premiered?: string
  language?: string
  popularity?: string
  avid?: string
}

export interface NfoActor {
  name: string
  role?: string
  thumb?: string
  profile?: string
  tmdbid?: string
}

// ─── XML 解析 ─────────────────────────────────────────────

function getTag(content: string, tag: string): string | undefined {
  const m = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
  return m?.[1]?.trim() || undefined
}

function getAllTags(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gi')
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const v = m[1].trim()
    if (v) results.push(v)
  }
  return results
}

/**
 * 解析 NFO XML 内容为 NfoData 结构
 * 统一处理 Kodi 标准的嵌套 ratings 结构和平展 rating 结构
 */
export function parseNfo(content: string): NfoData {
  if (!content) return {}

  const data: NfoData = {
    title: getTag(content, 'title'),
    originaltitle: getTag(content, 'originaltitle'),
    year: getTag(content, 'year'),
    plot: getTag(content, 'plot'),
    outline: getTag(content, 'outline'),
    runtime: getTag(content, 'runtime'),
    premiered: getTag(content, 'premiered'),
    language: getTag(content, 'language'),
    tmdbid: getTag(content, 'tmdbid'),
    avid: getTag(content, 'avid'),
    popularity: getTag(content, 'popularity'),
  }

  // 类型
  data.genres = getAllTags(content, 'genre')

  // 导演
  data.directors = getAllTags(content, 'director')

  // 国家
  data.countries = getAllTags(content, 'country')

  // 制片公司
  data.studios = getAllTags(content, 'studio')

  // 评分：优先从 <ratings><rating> 嵌套结构中取 <value> 和 <votes>
  const nestedValue = content.match(
    /<ratings>[\s\S]*?<value>([^<]+)<\/value>[\s\S]*?<\/ratings>/i
  )
  const nestedVotes = content.match(
    /<ratings>[\s\S]*?<votes>([^<]+)<\/votes>[\s\S]*?<\/ratings>/i
  )
  if (nestedValue) {
    data.rating = nestedValue[1].trim()
  } else {
    data.rating = getTag(content, 'rating')
  }
  if (nestedVotes) {
    data.votes = nestedVotes[1].trim()
  }

  // 海报和背景图
  const posterThumb = content.match(
    /<thumb\s+aspect="poster"[^>]*>([^<]+)<\/thumb>/i
  )
  if (posterThumb) data.poster = posterThumb[1].trim()

  const backdropThumb = content.match(
    /<thumb\s+aspect="backdrop"[^>]*>([^<]+)<\/thumb>/i
  )
  if (backdropThumb) data.backdrop = backdropThumb[1].trim()

  // 演员
  const actors: NfoActor[] = []
  const actorBlockRe = /<actor>([\s\S]*?)<\/actor>/gi
  let block: RegExpExecArray | null
  while ((block = actorBlockRe.exec(content)) !== null) {
    const b = block[1]
    const nameM = b.match(/<name>([^<]+)<\/name>/i)
    if (!nameM) continue
    actors.push({
      name: nameM[1].trim(),
      role: b.match(/<role>([^<]+)<\/role>/i)?.[1]?.trim(),
      thumb: b.match(/<thumb>([^<]+)<\/thumb>/i)?.[1]?.trim(),
      profile: b.match(/<profile>([^<]+)<\/profile>/i)?.[1]?.trim(),
      tmdbid: b.match(/<tmdbid>([^<]+)<\/tmdbid>/i)?.[1]?.trim(),
    })
  }
  if (actors.length) data.actors = actors

  return data
}

// ─── XML 生成 ─────────────────────────────────────────────

/**
 * 从 ScrapedMovie 生成 Kodi 标准 NFO XML
 * 统一处理 TMDB 和 JavBus 两种数据源
 */
export function generateNfo(movie: ScrapedMovie): string {
  const javbusMeta = movie._javbus

  // JavBus 路径：直接从 _javbus 构建
  if (javbusMeta) {
    return generateJavbusNfo(movie, javbusMeta)
  }

  // TMDB 路径
  return generateTmdbNfo(movie)
}

function generateTmdbNfo(movie: ScrapedMovie): string {
  const year = movie.release_date
    ? new Date(movie.release_date).getFullYear()
    : ''

  const genresXml = (movie.genres || [])
    .map(g => `  <genre>${escapeXml(g.name)}</genre>`)
    .join('\n')

  const directorsXml = (movie.directors || [])
    .map(d => `  <director>${escapeXml(d.name)}</director>`)
    .join('\n')

  const countriesXml = (movie.production_countries || [])
    .map(c => `  <country>${escapeXml(c.name)}</country>`)
    .join('\n')

  const studiosXml = (movie.production_companies || [])
    .map(s => `  <studio>${escapeXml(s.name)}</studio>`)
    .join('\n')

  const castXml = (movie.cast || [])
    .map(
      (actor: CastMember) => `  <actor>
    <name>${escapeXml(actor.name)}</name>
    ${actor.character ? `<role>${escapeXml(actor.character)}</role>` : ''}
    ${actor.profile_path ? `<thumb>${getImageBaseUrl('actor')}${actor.profile_path}</thumb>` : ''}
    <profile>https://www.themoviedb.org/person/${actor.id}</profile>
    <tmdbid>${actor.id}</tmdbid>
  </actor>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${escapeXml(movie.title || '')}</title>
  <originaltitle>${escapeXml(movie.original_title || movie.title || '')}</originaltitle>
  <year>${year}</year>
  <ratings>
    <rating default="true" max="10" name="themoviedb">
      <value>${movie.vote_average || 0}</value>
      <votes>${movie.vote_count || 0}</votes>
    </rating>
  </ratings>
  <plot>${escapeXml(movie.overview || '')}</plot>
  <outline>${escapeXml(movie.overview || '')}</outline>
${movie.runtime ? `  <runtime>${movie.runtime}</runtime>` : ''}
${genresXml}
${countriesXml}
${studiosXml}
  <thumb aspect="poster">${movie.poster_path || ''}</thumb>
  <thumb aspect="backdrop">${movie.backdrop_path || ''}</thumb>
  <tmdbid>${movie.id || 0}</tmdbid>
  <premiered>${movie.release_date || ''}</premiered>
  <language>${movie.original_language || ''}</language>
  <popularity>${movie.popularity || 0}</popularity>
  <adult>${movie.adult ? 'true' : 'false'}</adult>
${directorsXml}
${castXml}
</movie>`
}

interface JavbusMetaLite {
  title?: string
  avid?: string
  description?: string
  release_date?: string
  duration?: string
  keywords?: string[]
  actress?: Record<string, string>
}

function generateJavbusNfo(
  movie: ScrapedMovie,
  meta: JavbusMetaLite
): string {
  const year = meta.release_date
    ? new Date(meta.release_date).getFullYear()
    : ''

  const genresXml = (meta.keywords || [])
    .map(k => `  <genre>${escapeXml(k)}</genre>`)
    .join('\n')

  const actressXml = Object.keys(meta.actress || {})
    .map(name => `  <actor>\n    <name>${escapeXml(name)}</name>\n  </actor>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${escapeXml(meta.title || movie.title || '')}</title>
  <originaltitle>${escapeXml(meta.avid || '')}</originaltitle>
  <year>${year}</year>
  <plot>${escapeXml(meta.description || '')}</plot>
  <outline>${escapeXml(meta.description || '')}</outline>
  <runtime>${meta.duration || ''}</runtime>
${genresXml}
  <premiered>${meta.release_date || ''}</premiered>
${actressXml}
</movie>`
}
