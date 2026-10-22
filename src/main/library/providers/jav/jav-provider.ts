/**
 * 番号元数据源：按设置里的站点开关与优先级逐站查询，聚合成一份入库元数据。
 *
 * - 网络：全部经 ProviderHttp.getText（Electron net.fetch，Chromium 网络栈与系统代理），限速偏保守；
 * - 防护：Cloudflare 挑战 / 硬封锁页按主机熔断（与 PR #41 的 host-breaker 规则相同），
 *   熔断期间该站直接跳过，不拖慢整批识别；
 * - 缓存：每个站点解析后的结果按「站点 + 番号」存进 provider_cache（不存整页 HTML），
 *   查到的缓存 7 天，查无此片缓存 1 天；网络失败不缓存。
 */
import type { MediaMetadata } from '../../../../shared/library/provider'
import type { JavSettings } from '../../../../shared/library/ipc'
import { classifyPage } from '../../../../shared/net/cf-page'
import {
  type HostBreaker,
  HostUnavailableError,
  createHostBreaker,
} from '../../../../shared/net/host-breaker'
import type { BinaryFetch } from '../../images/image-cache'
import { type ImageProbe, createImageProbe } from '../../images/image-size'
import type { ResponseCache } from '../http/provider-cache'
import {
  type FetchLike,
  ProviderHttp,
  ProviderHttpError,
} from '../http/provider-http'
import type { Clock } from '../http/rate-limiter'
import type { ActorContext, ActorSource } from './actors'
import { createGfriendsSource } from './actors/sources/gfriends'
import { type JavMovie, aggregate, toMetadata } from './aggregate'
import { type JavCode, parseJavCode } from './number'
import { type JavCredentials, createJavSites } from './sites/registry'
import type { JavRecord, JavSite, PageOptions, SiteContext } from './types'

const DAY = 86_400_000
/** 站点海报高度达到它就算原生高清，不再从封面裁（封面裁出的海报高 538）。 */
export const HD_POSTER_HEIGHT = 500
/** 站点结果缓存时长。 */
export const JAV_TTL = { found: 7 * DAY, missing: DAY } as const

/** 与 Electron 37（Chromium 138）一致的桌面 UA：net.fetch 默认 UA 带 Electron 字样，个别站会拦。 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

/**
 * 防护页判定。正常页面也常带 Cloudflare 的统计脚本 /cdn-cgi/challenge-platform/scripts/jsd/，
 * 共用的 classifyPage 会把它当成挑战页，这里先去掉这段再判定。
 */
export function pageVerdict(
  html: string | null
): ReturnType<typeof classifyPage> {
  return classifyPage(
    html?.replace(
      /\/cdn-cgi\/challenge-platform\/scripts\/jsd\/[^'"\s]*/g,
      ''
    ) ?? null
  )
}

/** 内置站点（不带用户凭据；测试与缺省用）。 */
export const JAV_SITE_IMPLS: readonly JavSite[] = createJavSites()

/** 按主机懒建出网客户端（每个主机一个，各自限速），给 JavProviderOptions.http 用。 */
export function perHost(
  make: () => ProviderHttp
): (host: string) => ProviderHttp {
  const byHost = new Map<string, ProviderHttp>()
  return host => {
    let http = byHost.get(host)
    if (!http) byHost.set(host, (http = make()))
    return http
  }
}

/** 构造参数。 */
export interface JavProviderOptions {
  /**
   * 出网客户端。给函数时按主机各用一个（各站独立限速：一个慢站不拖住其它站，
   * 二十几个站并行查也不会对单站过快）；给实例时所有站点共用。
   */
  http: ProviderHttp | ((host: string) => ProviderHttp)
  cache?: ResponseCache
  /** 每次查询时读取当前站点设置。 */
  settings: () => JavSettings
  /**
   * 给站点没带头像的演员补头像的来源（只用它的头像）。缺省 gfriends（整理过的女优头像库，
   * 索引只拉一次）；null 关闭。sites 注入（测试）时缺省关闭。
   */
  avatars?: ActorSource | null
  /** 每次查询时读取站点凭据；缺省没有凭据。sites 注入时忽略。 */
  credentials?: () => JavCredentials
  /** 站点实现，测试注入；缺省为内置站点。 */
  sites?: readonly JavSite[]
  breaker?: HostBreaker
  /** 探测站点海报尺寸（决定要不要从封面裁）；缺省不探测，有码片一律裁。 */
  probeImage?: ImageProbe
  now?: () => number
  log?: (message: string) => void
}

/** 番号字符串 → 解析结果（手动输入或库里存的番号；认不出时按有码原样查）。 */
export function codeOf(code: string): JavCode {
  return (
    parseJavCode(code) ?? {
      code: code.trim().toUpperCase(),
      kind: 'censored',
      subtitle: false,
    }
  )
}

/** 番号元数据源。 */
export class JavProvider {
  private readonly breaker: HostBreaker
  private readonly now: () => number
  private readonly log: (message: string) => void

  private readonly sites: ReadonlyMap<string, JavSite>
  private readonly avatars: ActorSource | null

  constructor(private readonly options: JavProviderOptions) {
    this.sites = new Map(
      (
        options.sites ?? createJavSites(options.credentials ?? (() => ({})))
      ).map(s => [s.id, s])
    )
    this.avatars =
      options.avatars !== undefined
        ? options.avatars
        : options.sites
          ? null
          : createGfriendsSource()
    this.breaker = options.breaker ?? createHostBreaker()
    this.now = options.now ?? Date.now
    this.log = options.log ?? (() => {})
  }

  /** 按优先级排好、已开启且支持这类番号的站点。 */
  private sitesFor(code: JavCode): JavSite[] {
    return this.options
      .settings()
      .sites.filter(s => s.enabled)
      .map(s => this.sites.get(s.id))
      .filter((s): s is JavSite => Boolean(s?.supports(code.kind)))
  }

  /**
   * 查一个番号并聚合。所有站点都查无此片返回 null；
   * 没有任何站点给出结论（全部网络失败 / 被拦）时抛 ProviderHttpError，识别计为失败而不是未匹配。
   */
  async scrape(code: JavCode, signal?: AbortSignal): Promise<JavMovie | null> {
    const sites = this.sitesFor(code)
    const settled = await Promise.all(
      sites.map(site => this.fromSite(site, code, signal))
    )
    const records = settled.filter((r): r is JavRecord => Boolean(r))
    if (
      !records.length &&
      sites.length &&
      settled.every(r => r === undefined)
    ) {
      throw new ProviderHttpError(`番号站点都无法访问（${code.code}）`)
    }
    const movie = aggregate(records)
    if (!movie) return null
    // 番号以文件名解析出的写法为准（条目 id 稳定）；站点页面上的写法可能缺数字前缀等
    return {
      ...movie,
      code: code.code,
      actors: await this.withAvatars(movie, signal),
    }
  }

  /**
   * 给没头像的演员补头像。补不到（来源被墙、没收录）就保持原样，绝不让刮削因此失败；
   * gfriends 的索引首次下载后在内存里，之后每个演员都是本地查表。
   */
  private async withAvatars(
    movie: JavMovie,
    signal?: AbortSignal
  ): Promise<JavMovie['actors']> {
    const avatars = this.avatars
    if (!avatars || movie.actors.every(a => a.photo)) return movie.actors
    const ctx = this.context(signal)
    return Promise.all(
      movie.actors.map(async actor => {
        if (actor.photo) return actor
        try {
          const photo = (await avatars.fetch(actor.name, ctx))?.images[0]
          return photo ? { ...actor, photo } : actor
        } catch (error) {
          if (signal?.aborted) throw error
          return actor
        }
      })
    )
  }

  /** 番号 → 入库元数据；查不到返回 null。 */
  async metadata(
    code: string,
    signal?: AbortSignal
  ): Promise<MediaMetadata | null> {
    const parsed = codeOf(code)
    const movie = await this.scrape(parsed, signal)
    if (!movie) return null
    return toMetadata(movie, await this.posterPlan(movie, parsed, signal))
  }

  /**
   * 有码片的封面是 DMM 版式（右半是正面）：站点海报缺失、太小、不是竖图或探测不到尺寸时从封面裁；
   * 站点给的是原生高清竖版海报（高 ≥ HD_POSTER_HEIGHT）就直接用。无码 / FC2 / 素人不裁。
   */
  private async posterPlan(
    movie: JavMovie,
    code: JavCode,
    signal?: AbortSignal
  ): Promise<'native' | 'crop'> {
    if (code.kind !== 'censored' || !movie.cover) return 'native'
    if (!movie.poster || !this.options.probeImage) return 'crop'
    const size = await this.options.probeImage(movie.poster, signal)
    // 个别站标成海报的其实是横图（如 MGStage 的 pb_e），也按不可用处理
    const portrait = size && size.height > size.width
    return portrait && size.height >= HD_POSTER_HEIGHT ? 'native' : 'crop'
  }

  /** 查一个站点：命中缓存直接用；查无此片为 null；网络失败 / 被拦为 undefined（不缓存）。 */
  private async fromSite(
    site: JavSite,
    code: JavCode,
    signal?: AbortSignal
  ): Promise<JavRecord | null | undefined> {
    const key = `jav:${site.id}:${code.code}`
    const now = this.now()
    const cached = this.options.cache?.get(key)
    if (cached && cached.expiresAt > now)
      return JSON.parse(cached.body) as JavRecord | null
    try {
      const record = await site.fetch(code, this.context(signal))
      this.options.cache?.set(
        key,
        {
          body: JSON.stringify(record),
          etag: null,
          expiresAt: now + (record ? JAV_TTL.found : JAV_TTL.missing),
        },
        now
      )
      return record
    } catch (error) {
      if (signal?.aborted) throw error
      this.log(
        `番号站点 ${site.id} 查询 ${code.code} 失败：${(error as Error).message}`
      )
      return undefined
    }
  }

  /** 站点用的取页上下文：熔断检查、请求头、防护页识别。 */
  private context(signal?: AbortSignal): SiteContext {
    return {
      signal,
      page: (url: string, options?: PageOptions) =>
        this.page(url, options, signal),
      issuedCookies: (url: string, options: PageOptions = {}) =>
        this.issuedCookies(url, options, signal),
    }
  }

  /**
   * 演员资料来源用的上下文：与番号站点共用熔断、按主机限速和防护页识别，
   * 另提供 postJson（ThePornDB 的 GraphQL）。演员库的后台任务用它查资料。
   */
  actorContext(signal?: AbortSignal): ActorContext {
    return {
      ...this.context(signal),
      postJson: async (url, body, headers = {}) => {
        const text = await this.page(
          url,
          {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', ...headers },
          },
          signal
        )
        return text === null ? null : (JSON.parse(text) as unknown)
      },
    }
  }

  /** 这个地址用哪个出网客户端。 */
  private httpFor(url: string): ProviderHttp {
    const { http } = this.options
    return typeof http === 'function' ? http(new URL(url).host) : http
  }

  /** 领取会话 Cookie（见 SiteContext.issuedCookies）：与取页同一套熔断。 */
  private async issuedCookies(
    url: string,
    options: PageOptions,
    signal?: AbortSignal
  ): Promise<string[]> {
    const trip = this.breaker.check(url)
    if (trip) throw new HostUnavailableError(trip)
    try {
      return await this.httpFor(url).getCookies({
        url,
        headers: {
          'User-Agent': USER_AGENT,
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
        signal,
      })
    } catch (error) {
      if (!signal?.aborted) this.breaker.fail(url, 'unreachable')
      throw error
    }
  }

  private async page(
    url: string,
    options: PageOptions = {},
    signal?: AbortSignal
  ): Promise<string | null> {
    const trip = this.breaker.check(url)
    if (trip) throw new HostUnavailableError(trip)
    let html: string | null
    try {
      html = await this.httpFor(url).getText({
        url,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
        signal,
        method: options.method,
        body: options.body,
      })
    } catch (error) {
      // 403 多半是 Cloudflare 挑战（个别客户端指纹过不去，稍后也可能就过了）：按失败计数，连续几次才熔断
      if (!signal?.aborted) {
        const forbidden =
          error instanceof ProviderHttpError && error.status === 403
        this.breaker.fail(url, forbidden ? 'blocked' : 'unreachable')
      }
      throw error
    }
    const verdict = pageVerdict(html)
    if (verdict === 'blocked') {
      this.breaker.block(url)
      throw new ProviderHttpError(`${new URL(url).hostname} 拦截了请求`, 403)
    }
    if (verdict === 'challenge') {
      this.breaker.fail(url, 'challenge')
      throw new ProviderHttpError(`${new URL(url).hostname} 要求人机验证`)
    }
    this.breaker.succeed(url)
    return html
  }
}

/** createJavProvider 的参数。 */
export interface CreateJavProviderOptions extends Pick<
  JavProviderOptions,
  'cache' | 'settings' | 'credentials' | 'avatars' | 'log'
> {
  /** 站点页面与图片探测共用（探测站点海报尺寸要读二进制）。 */
  fetch: FetchLike & BinaryFetch
  clock?: Clock
}

/**
 * 按引擎的默认网络策略建番号元数据源：番号站点是普通网站，每个主机一个客户端各自限速
 * （2 rps、并发 2），重试少一些，被拦的站点由熔断跳过。
 */
export function createJavProvider(
  options: CreateJavProviderOptions
): JavProvider {
  const { fetch, clock, ...rest } = options
  return new JavProvider({
    ...rest,
    probeImage: createImageProbe(fetch),
    http: perHost(
      () =>
        new ProviderHttp({
          fetch,
          rps: 2,
          concurrency: 2,
          maxRetries: 2,
          clock,
        })
    ),
  })
}
