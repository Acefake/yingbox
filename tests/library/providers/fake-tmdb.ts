/**
 * 测试用的假 TMDB：详情 / 季 / 剧集分组直接返回 tests/fixtures/tmdb 下按 API 路径存放的响应
 * （TMDB v3 响应格式，可用 scripts/record-tmdb-fixtures.ts 换成真实录制），
 * 搜索与 /find 由这些详情模拟：标题、各语言译名、别名做子串匹配，按热度排序，支持年份过滤。
 *
 * 支持：Bearer 鉴权（401）、ETag / If-None-Match（304）、可注入延迟、请求记录、图片下载。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { HttpFetch } from '../../../src/main/library/identify/identify-module'

export const FIXTURE_DIR = join(__dirname, '../../fixtures/tmdb')
export const FAKE_TOKEN = 'eyJ.fake.token'

export type Json = Record<string, unknown>

/** 构造参数。 */
export interface FakeTmdbOptions {
  /** 每个请求的延迟（毫秒），默认 0。 */
  latencyMs?: number
  /** 延迟实现，默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
  /** 要求的令牌；undefined 不校验。 */
  token?: string
  /** 直接给响应表（API 路径 → 响应），缺省读 fixture 目录（基准用合成数据）。 */
  fixtures?: Map<string, Json>
}

function loadFixtures(dir: string): Map<string, Json> {
  const out = new Map<string, Json>()
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.json')) {
        const key = `/${relative(dir, path)
          .replace(/\\/g, '/')
          .replace(/\.json$/, '')}`
        out.set(key, JSON.parse(readFileSync(path, 'utf8')) as Json)
      }
    }
  }
  walk(dir)
  return out
}

/** 搜索用的简单归一：小写、去空白与标点。 */
const squash = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

interface Translation {
  iso_639_1: string
  iso_3166_1: string
  data: { title?: string; name?: string; overview?: string }
}

/** 假 TMDB。 */
export class FakeTmdb {
  readonly fixtures: Map<string, Json>
  /** 收到的请求（路径 + 查询，不含 api_key）。 */
  readonly requests: string[] = []
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: FakeTmdbOptions = {}) {
    this.fixtures = options.fixtures ?? loadFixtures(FIXTURE_DIR)
    this.sleep =
      options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  /** 请求计数（按路径前缀过滤）。 */
  count(prefix = ''): number {
    return this.requests.filter(r => r.startsWith(prefix)).length
  }

  readonly fetch: HttpFetch = (async (
    url: string,
    init: { headers?: Record<string, string> }
  ) => {
    if (this.options.latencyMs) await this.sleep(this.options.latencyMs)
    const u = new URL(url)
    if (u.hostname === 'image.tmdb.org') {
      return respond(200, Buffer.from(`fake-image:${u.pathname}`), {
        'content-type': 'image/jpeg',
      })
    }
    u.searchParams.delete('api_key')
    const path = u.pathname.replace(/^\/3/, '')
    this.requests.push(`${path}?${u.searchParams}`)
    if (
      this.options.token &&
      init.headers?.Authorization !== `Bearer ${this.options.token}`
    ) {
      return respond(401, '{"status_code":7}')
    }
    const body = this.route(path, u.searchParams)
    if (body === undefined) return respond(404, '{"status_code":34}')
    const text = JSON.stringify(body)
    const etag = `"${createHash('md5').update(text).digest('hex')}"`
    if (init.headers?.['If-None-Match'] === etag) {
      return respond(304, '', { etag })
    }
    return respond(200, text, { etag, 'content-type': 'application/json' })
  }) as HttpFetch

  private route(path: string, q: URLSearchParams): unknown {
    const search = /^\/search\/(movie|tv)$/.exec(path)
    if (search) return this.search(search[1] as 'movie' | 'tv', q)
    const find = /^\/find\/(.+)$/.exec(path)
    if (find) return this.find(decodeURIComponent(find[1]), q)
    const details = /^\/(movie|tv)\/(\d+)$/.exec(path)
    if (details) {
      const raw = this.fixtures.get(path)
      return raw
        ? localize(
            raw,
            details[1] as 'movie' | 'tv',
            q.get('language') ?? 'en-US'
          )
        : undefined
    }
    return this.fixtures.get(path)
  }

  private readonly entityCache = new Map<string, Json[]>()
  private readonly titleCache = new WeakMap<Json, string[]>()

  /** 条目可被搜到的标题（已归一，缓存）。 */
  private searchable(e: Json, kind: 'movie' | 'tv'): string[] {
    let titles = this.titleCache.get(e)
    if (!titles) {
      titles = titlesOf(e, kind).map(squash)
      this.titleCache.set(e, titles)
    }
    return titles
  }

  private entities(kind: 'movie' | 'tv'): Json[] {
    let list = this.entityCache.get(kind)
    if (!list) {
      const re = new RegExp(`^/${kind}/\\d+$`)
      list = [...this.fixtures.entries()]
        .filter(([k]) => re.test(k))
        .map(([, v]) => v)
      this.entityCache.set(kind, list)
    }
    return list
  }

  private search(kind: 'movie' | 'tv', q: URLSearchParams): Json {
    const query = squash(q.get('query') ?? '')
    const year = q.get(kind === 'movie' ? 'year' : 'first_air_date_year')
    const language = q.get('language') ?? 'en-US'
    const results = this.entities(kind)
      .filter(e => {
        const date = String(
          e[kind === 'movie' ? 'release_date' : 'first_air_date'] ?? ''
        )
        if (year && !date.startsWith(year)) return false
        return this.searchable(e, kind).some(t => t.includes(query))
      })
      .sort((a, b) => Number(b.popularity) - Number(a.popularity))
      .map(e => summary(localize(e, kind, language), kind))
    return { page: 1, results, total_results: results.length, total_pages: 1 }
  }

  private find(id: string, q: URLSearchParams): Json {
    const source = q.get('external_source')
    const match = (e: Json): boolean => {
      const ext = (e.external_ids ?? {}) as Json
      return source === 'imdb_id'
        ? ext.imdb_id === id
        : String(ext.tvdb_id ?? '') === id
    }
    const language = q.get('language') ?? 'en-US'
    return {
      movie_results: this.entities('movie')
        .filter(match)
        .map(e => summary(localize(e, 'movie', language), 'movie')),
      tv_results: this.entities('tv')
        .filter(match)
        .map(e => summary(localize(e, 'tv', language), 'tv')),
    }
  }
}

function respond(
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {}
): Awaited<ReturnType<HttpFetch>> {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  )
  const bytes = typeof body === 'string' ? Buffer.from(body) : body
  return {
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    text: async () => bytes.toString('utf8'),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Awaited<ReturnType<HttpFetch>>
}

function translations(e: Json): Translation[] {
  return ((e.translations as Json)?.translations ?? []) as Translation[]
}

function titlesOf(e: Json, kind: 'movie' | 'tv'): string[] {
  const key = kind === 'movie' ? 'title' : 'name'
  const alt = (e.alternative_titles as Json | undefined)?.[
    kind === 'movie' ? 'titles' : 'results'
  ] as Array<{ title: string }> | undefined
  return [
    String(e[kind === 'movie' ? 'original_title' : 'original_name'] ?? ''),
    ...translations(e).map(t => String(t.data[key] ?? '')),
    ...(alt ?? []).map(a => a.title),
  ].filter(Boolean)
}

/** 按语言给出 title / name 与 overview（没有该语言译名时用原名）。 */
function localize(e: Json, kind: 'movie' | 'tv', language: string): Json {
  const [lang, region] = language.split('-')
  const key = kind === 'movie' ? 'title' : 'name'
  const t = translations(e).find(
    x => x.iso_639_1 === lang && x.iso_3166_1 === region
  )
  return {
    ...e,
    [key]:
      t?.data[key] || e[kind === 'movie' ? 'original_title' : 'original_name'],
    overview: t?.data.overview ?? '',
  }
}

/** 搜索结果里的精简条目。 */
function summary(e: Json, kind: 'movie' | 'tv'): Json {
  const keys =
    kind === 'movie'
      ? [
          'id',
          'title',
          'original_title',
          'original_language',
          'release_date',
          'popularity',
          'vote_count',
          'poster_path',
        ]
      : [
          'id',
          'name',
          'original_name',
          'original_language',
          'first_air_date',
          'popularity',
          'vote_count',
          'poster_path',
        ]
  return Object.fromEntries(keys.map(k => [k, e[k]]))
}
