/**
 * OpenSubtitles moviehash 反查：文件哈希 → 作品（电影 / 整部剧）的 TMDB 引用。
 *
 * 只在配置了 API key 时启用（引擎设置或环境变量 YINGBOX_OPENSUBTITLES_KEY）；没有 key 时
 * 识别链直接跳过这一步。结果按哈希缓存 30 天（包括查不到），免费额度很紧，限速 4 rps。
 */
import type { HashLookup } from '../../../../shared/library/identify'
import type { MediaRef } from '../../../../shared/library/provider'
import type { ProviderHttp } from '../http/provider-http'

const API = 'https://api.opensubtitles.com/api/v1'
const TTL = 30 * 86_400_000
const USER_AGENT = 'yingbox v1.0.0'

/** /subtitles 响应里用到的字段。 */
interface OsSubtitlesResponse {
  data?: Array<{
    attributes?: {
      moviehash_match?: boolean
      feature_details?: {
        feature_type?: string
        tmdb_id?: number | null
        parent_tmdb_id?: number | null
      }
    }
  }>
}

/** 从 /subtitles 结果里取哈希精确命中的作品。 */
export function refFromOsResponse(
  body: OsSubtitlesResponse | null
): MediaRef | null {
  for (const item of body?.data ?? []) {
    const attrs = item.attributes
    if (!attrs?.moviehash_match) continue
    const f = attrs.feature_details
    if (!f) continue
    if (f.feature_type === 'Movie' && f.tmdb_id) {
      return { provider: 'tmdb', kind: 'movie', id: String(f.tmdb_id) }
    }
    if (f.feature_type === 'Episode' && f.parent_tmdb_id) {
      return { provider: 'tmdb', kind: 'tv', id: String(f.parent_tmdb_id) }
    }
  }
  return null
}

/** OpenSubtitles 哈希反查。 */
export class OpenSubtitlesHashLookup implements HashLookup {
  constructor(
    private readonly http: ProviderHttp,
    private readonly apiKey: () => string | undefined
  ) {}

  /** 是否已配置 key。 */
  get configured(): boolean {
    return Boolean(this.apiKey())
  }

  async lookup(
    hash: string,
    _size: number,
    signal?: AbortSignal
  ): Promise<MediaRef | null> {
    const key = this.apiKey()
    if (!key || !/^[0-9a-f]{16}$/.test(hash)) return null
    const body = await this.http.getJson<OsSubtitlesResponse>({
      url: `${API}/subtitles?moviehash=${hash}`,
      headers: { 'Api-Key': key, 'User-Agent': USER_AGENT },
      cacheKey: `os:hash:${hash}`,
      ttl: () => TTL,
      notFoundTtl: TTL,
      signal,
    })
    return refFromOsResponse(body)
  }
}
