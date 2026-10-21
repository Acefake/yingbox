/**
 * TMDB 详情里的人员与分级：演员表（按 order 取前 CAST_LIMIT 位）、幕后（创作者 + 保留职务，导演在前）、
 * 分级（中国大陆 > 美国 > 任意）。纯函数。
 */
import type {
  MediaKind,
  PersonCredit,
} from '../../../../shared/library/provider'
import { type TmdbDetails, isMovie, nonEmpty } from './tmdb-text'
import type { TmdbTvDetails } from './tmdb-types'

/** 演员表最多保留几位。 */
export const CAST_LIMIT = 15
/** 保留的幕后职务。 */
const CREW_JOBS = new Set([
  'Director',
  'Screenplay',
  'Writer',
  'Story',
  'Novel',
])

/** 分级：中国大陆优先，其次美国，再其次任意有值的。电影院线（type 3）优先。 */
export function certificationOf(
  kind: MediaKind,
  d: TmdbDetails
): string | undefined {
  const byCountry = new Map<string, string>()
  if (isMovie(kind, d)) {
    for (const r of d.release_dates?.results ?? []) {
      // 院线（type 3）优先，其次任意有值的
      const dates = [...(r.release_dates ?? [])].sort(
        (a, b) => Number(b.type === 3) - Number(a.type === 3)
      )
      const cert = dates.map(x => nonEmpty(x.certification)).find(Boolean)
      if (cert && r.iso_3166_1) byCountry.set(r.iso_3166_1, cert)
    }
  } else {
    for (const r of (d as TmdbTvDetails).content_ratings?.results ?? []) {
      const cert = nonEmpty(r.rating)
      if (cert && r.iso_3166_1) byCountry.set(r.iso_3166_1, cert)
    }
  }
  return (
    byCountry.get('CN') ??
    byCountry.get('US') ??
    byCountry.values().next().value
  )
}

/** 演员表：按 order 排序取前 CAST_LIMIT 位。 */
export function castOf(d: TmdbDetails): PersonCredit[] {
  return [...(d.credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT)
    .map(c => ({
      id: String(c.id),
      name: c.name ?? '',
      ...(c.original_name && c.original_name !== c.name
        ? { originalName: c.original_name }
        : {}),
      ...(nonEmpty(c.character) ? { character: c.character!.trim() } : {}),
      ...(c.profile_path ? { profilePath: c.profile_path } : {}),
      order: c.order,
    }))
}

/** 幕后人员：剧集的创作者 + 保留职务，按 人+职务 去重，导演在前。 */
export function crewOf(kind: MediaKind, d: TmdbDetails): PersonCredit[] {
  const seen = new Set<string>()
  const out: PersonCredit[] = []
  const push = (p: PersonCredit): void => {
    const key = `${p.id}:${p.job}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  if (!isMovie(kind, d)) {
    for (const c of (d as TmdbTvDetails).created_by ?? []) {
      push({
        id: String(c.id),
        name: c.name ?? '',
        job: 'Creator',
        ...(c.profile_path ? { profilePath: c.profile_path } : {}),
      })
    }
  }
  for (const c of d.credits?.crew ?? []) {
    if (!c.job || !CREW_JOBS.has(c.job)) continue
    push({
      id: String(c.id),
      name: c.name ?? '',
      ...(c.original_name && c.original_name !== c.name
        ? { originalName: c.original_name }
        : {}),
      job: c.job,
      ...(c.profile_path ? { profilePath: c.profile_path } : {}),
    })
  }
  // 导演在前
  return out.sort(
    (a, b) => Number(b.job === 'Director') - Number(a.job === 'Director')
  )
}
