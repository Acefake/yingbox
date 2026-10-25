/**
 * OpenSubtitles.com API v1：按 TMDB id / 季集 / 文件哈希搜中文字幕、下载成 srt 字节。
 * 和识别用的哈希反查（providers/opensubtitles）共用同一个 API key（片库设置或环境变量）。
 *
 * 两次请求之间至少隔 {@link OS_GAP_MS}（免费额度很紧，官方限 5 次 / 秒，这里放得更松）。
 * 错误分三类，自动字幕据此决定怎么办：没 key / key 无效（{@link OsAuthError}，整轮停）、
 * 今天的下载额度用完（{@link OsQuotaError}，等到明天）、其余（网络 / 5xx，按退避重试）。
 */
import { gunzipSync } from 'node:zlib'
import type { SubtitleHit } from './subtitle-rules'

const API = 'https://api.opensubtitles.com/api/v1'
const USER_AGENT = 'yingbox v1.0.0'
/** 两次请求的最短间隔。 */
export const OS_GAP_MS = 1500
/** 字幕文件上限（普通 srt 远小于它）。 */
const MAX_BYTES = 5 * 1024 * 1024

/** key 缺失或无效。 */
export class OsAuthError extends Error {
  override name = 'OsAuthError'
}

/** 下载额度用完。 */
export class OsQuotaError extends Error {
  override name = 'OsQuotaError'
}

/** 搜索条件：电影给 tmdbId；集给 parentTmdbId + 季 + 集；有文件哈希就带上；都没有时按片名。 */
export interface OsSearch {
  tmdbId?: string
  parentTmdbId?: string
  season?: number
  episode?: number
  moviehash?: string
  query?: string
  year?: number
}

/** /subtitles 响应里用到的字段。 */
interface OsSubtitlesBody {
  data?: Array<{
    attributes?: {
      language?: string
      download_count?: number
      hearing_impaired?: boolean
      machine_translated?: boolean
      ai_translated?: boolean
      from_trusted?: boolean
      moviehash_match?: boolean
      release?: string
      files?: Array<{ file_id?: number }>
    }
  }>
}

/** 搜索参数（OpenSubtitles 要求参数按字母排序、值小写，否则会多一次 301）。 */
export function searchParams(search: OsSearch): string {
  const params: Array<[string, string]> = [['languages', 'zh-cn,zh-tw']]
  if (search.tmdbId) params.push(['tmdb_id', search.tmdbId])
  if (search.parentTmdbId) params.push(['parent_tmdb_id', search.parentTmdbId])
  if (search.season !== undefined)
    params.push(['season_number', String(search.season)])
  if (search.episode !== undefined)
    params.push(['episode_number', String(search.episode)])
  if (search.moviehash) params.push(['moviehash', search.moviehash])
  if (!search.tmdbId && !search.parentTmdbId && search.query) {
    params.push(['query', search.query.toLowerCase()])
    if (search.year) params.push(['year', String(search.year)])
  }
  params.sort(([a], [b]) => a.localeCompare(b))
  return new URLSearchParams(params).toString()
}

/** /subtitles 响应 → 候选。 */
export function hitsFromBody(body: OsSubtitlesBody | null): SubtitleHit[] {
  const out: SubtitleHit[] = []
  for (const item of body?.data ?? []) {
    const a = item.attributes
    const fileId = a?.files?.find(f => typeof f.file_id === 'number')?.file_id
    if (!a || fileId === undefined) continue
    out.push({
      fileId,
      language: String(a.language ?? '').toLowerCase(),
      downloads: a.download_count ?? 0,
      hashMatch: a.moviehash_match === true,
      machine: a.machine_translated === true || a.ai_translated === true,
      hearingImpaired: a.hearing_impaired === true,
      trusted: a.from_trusted === true,
      release: a.release ?? '',
    })
  }
  return out
}

/** 注入的 fetch（标准 fetch 的子集；引擎里是 Electron net.fetch）。 */
export type OsFetch = (
  url: string,
  init: {
    method?: 'POST'
    headers?: Record<string, string>
    body?: string
  }
) => Promise<{
  status: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}>

/** 客户端依赖。 */
export interface OsClientDeps {
  fetch: OsFetch
  apiKey: () => string | undefined
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** OpenSubtitles 字幕客户端。 */
export class OsSubtitleClient {
  private last = -Infinity
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: OsClientDeps) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  }

  /** 是否配置了 key。 */
  get configured(): boolean {
    return Boolean(this.deps.apiKey()?.trim())
  }

  /** 搜中文字幕。 */
  async search(search: OsSearch): Promise<SubtitleHit[]> {
    const response = await this.request(
      `${API}/subtitles?${searchParams(search)}`,
      {}
    )
    return hitsFromBody(JSON.parse(await response.text()) as OsSubtitlesBody)
  }

  /** 下载一份字幕（srt 字节，已解 gzip）。 */
  async download(fileId: number): Promise<Uint8Array> {
    const response = await this.request(`${API}/download`, {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
    })
    const link = JSON.parse(await response.text()) as {
      link?: string
      remaining?: number
    }
    if (!link.link) throw new Error('OpenSubtitles 没有给下载地址')
    const file = await this.paced(() => this.deps.fetch(link.link!, {}))
    if (file.status !== 200)
      throw new Error(`字幕下载失败：HTTP ${file.status}`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new Error('字幕文件过大')
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
  }

  private async request(
    url: string,
    init: { method?: 'POST'; body?: string }
  ): Promise<{ status: number; text(): Promise<string> }> {
    const key = this.deps.apiKey()?.trim()
    if (!key) throw new OsAuthError('没有配置 OpenSubtitles API key')
    const response = await this.paced(() =>
      this.deps.fetch(url, {
        ...init,
        headers: {
          'Api-Key': key,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
    )
    if (response.status === 401 || response.status === 403)
      throw new OsAuthError('OpenSubtitles API key 无效')
    // 406：今天的下载次数用完；429：请求太快（同样等到下一轮）
    if (response.status === 406 || response.status === 429)
      throw new OsQuotaError('OpenSubtitles 今天的额度已用完')
    if (response.status !== 200)
      throw new Error(`OpenSubtitles 返回 HTTP ${response.status}`)
    return response
  }

  private async paced<T>(task: () => Promise<T>): Promise<T> {
    const wait = this.last + OS_GAP_MS - this.now()
    if (wait > 0) await this.sleep(wait)
    try {
      return await task()
    } finally {
      this.last = this.now()
    }
  }
}
