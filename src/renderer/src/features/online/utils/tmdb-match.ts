import type { TmdbDetail } from '../types'

/** 搜索结果（multi 额外携带媒体类型）。 */
export type TmdbCandidate = Partial<TmdbDetail> & { media_type?: string }

/** 待匹配作品的已知身份。 */
export interface TmdbIdentity {
  title: string
  originalTitle?: string
  year?: string
  kind: 'movie' | 'tv'
}

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** 收取片名、已知年份和类型一致的候选，保留歧义供调用方判断。 */
export function matchingTmdbCandidates<T extends TmdbCandidate>(
  candidates: readonly T[],
  identity: TmdbIdentity
): T[] {
  const title = normalize(identity.title)
  const original = normalize(identity.originalTitle ?? '')
  const year = identity.year?.match(/\b\d{4}\b/)?.[0]
  if (!title && !original) return []
  const matches = candidates.filter(candidate => {
    if (candidate.media_type && candidate.media_type !== identity.kind)
      return false
    const date = candidate.release_date || candidate.first_air_date || ''
    if (year && date.slice(0, 4) !== year) return false
    const names = [
      candidate.title,
      candidate.name,
      candidate.original_title,
      candidate.original_name,
    ]
      .filter((value): value is string => !!value)
      .map(normalize)
    const candidateOriginal = normalize(
      candidate.original_title || candidate.original_name || ''
    )
    if (original && candidateOriginal && original !== candidateOriginal)
      return false
    return (
      (title && names.includes(title)) || (original && names.includes(original))
    )
  })
  const unique = matches.filter(
    (candidate, index) =>
      candidate.id === undefined ||
      matches.findIndex(other => other.id === candidate.id) === index
  )
  return unique
}
