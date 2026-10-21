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
import type { ResponseCache } from '../http/provider-cache'
import { type ProviderHttp, ProviderHttpError } from '../http/provider-http'
import { type JavMovie, aggregate, toMetadata } from './aggregate'
import { type JavCode, parseJavCode } from './number'
import { avbase } from './sites/avbase'
import { fc2 } from './sites/fc2'
import { javbus } from './sites/javbus'
import type { JavRecord, JavSite, PageOptions, SiteContext } from './types'

const DAY = 86_400_000
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

/** 内置站点。 */
export const JAV_SITE_IMPLS: readonly JavSite[] = [javbus, avbase, fc2]

/** 构造参数。 */
export interface JavProviderOptions {
  http: ProviderHttp
  cache?: ResponseCache
  /** 每次查询时读取当前站点设置。 */
  settings: () => JavSettings
  /** 站点实现，测试注入；缺省为内置站点。 */
  sites?: readonly JavSite[]
  breaker?: HostBreaker
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

  constructor(private readonly options: JavProviderOptions) {
    this.breaker = options.breaker ?? createHostBreaker()
    this.now = options.now ?? Date.now
    this.log = options.log ?? (() => {})
  }

  /** 按优先级排好、已开启且支持这类番号的站点。 */
  private sitesFor(code: JavCode): JavSite[] {
    const impls = new Map(
      (this.options.sites ?? JAV_SITE_IMPLS).map(s => [s.id, s])
    )
    return this.options
      .settings()
      .sites.filter(s => s.enabled)
      .map(s => impls.get(s.id))
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
    // 番号以文件名解析出的写法为准（条目 id 稳定）；站点页面上的写法可能缺数字前缀等
    return movie && { ...movie, code: code.code }
  }

  /** 番号 → 入库元数据；查不到返回 null。 */
  async metadata(
    code: string,
    signal?: AbortSignal
  ): Promise<MediaMetadata | null> {
    const movie = await this.scrape(codeOf(code), signal)
    return movie ? toMetadata(movie) : null
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
      html = await this.options.http.getText({
        url,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
        signal,
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
