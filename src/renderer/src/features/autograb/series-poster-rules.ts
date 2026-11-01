/**
 * 追更列表里剧海报的兜底规则：片库里找不到这部剧（条目 id 随重新扫描变过、没刮到海报）时，
 * 按剧名问 TMDB 搜剧，取第一条有海报的结果。
 */

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** /search/tv 的返回 → 第一条有海报的结果的海报地址；没有为 null */
export function tmdbSearchPoster(raw: unknown): string | null {
  const results = isObj(raw) ? raw.results : null
  if (!Array.isArray(results)) return null
  for (const hit of results) {
    if (!isObj(hit)) continue
    const path = hit.poster_path
    if (typeof path === 'string' && path.startsWith('/'))
      return `${IMAGE_BASE}${path}`
  }
  return null
}
