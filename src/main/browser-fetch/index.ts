import {
  createHostBreaker,
  hostOf,
  pathScope,
} from '../../shared/net/host-breaker'
import { BlockedPageError, isUsablePage } from './page'
import { fetchViaSession, hasClearance } from './session'
import { fetchViaWindow } from './window'

/**
 * 浏览器级抓取：引擎直连拿到 Cloudflare 挑战页时，经宿主方法 browserFetch 请主进程代抓原始页面。
 *
 * 两条路，同一个 partition、同一个 UA：
 * - 窗口（window.ts）：开隐藏窗口渲染、等挑战脚本跑完。贵（开窗 + 渲染），请求串行，
 *   多个窗口同时闪出既打扰用户，同一出口频繁撞挑战还会被升级成必须人工点的 Turnstile。
 * - 会话直取（session.ts）：主机刚由窗口过过挑战（cf_clearance 约 30 分钟、绑 UA + 出口 IP）时，
 *   先用 session.fetch 带着 cookie 直接取页，不开窗口、可并发。拿到挑战页就作废记录、退回窗口；
 *   离窗口过挑战超过 25 分钟、或刚重启时，只要会话里还有没过期的 cf_clearance cookie，
 *   也先走会话直取（partition 持久化，cookie 跨重启保留），避免验证窗口反复弹出。
 *
 * 调用方（下载源、CatSpider 插件 $fetch）要的都是服务器发的原始 HTML，直连没被拦时
 * 解析的也是它，所以两条路的结果对调用方等价。
 *
 * 硬封锁页（Sorry, you have been blocked、Error 1020 等）不论哪条路读到都立即按主机 + 路径类别
 * 熔断 30 分钟，窗口从不显示，期间同类请求直接返回空串。
 */

/** 实例选项（测试注入时限与时钟）。 */
export interface BrowserFetchOptions {
  /** 窗口里等挑战通过的时限，默认 20 秒 */
  challengeWaitMs?: number
  /** 窗口过挑战后多久之内先走会话直取，默认 25 分钟（留出 cf_clearance 30 分钟寿命的余量） */
  clearanceTtlMs?: number
  now?: () => number
  /** 会话里是否有可用的 cf_clearance（测试注入），默认读 partition 的 cookie */
  hasClearance?: (url: string, nowMs: number) => Promise<boolean>
}

/** 一套代抓：熔断、排队、过挑战记录都在实例里。 */
export interface BrowserFetcher {
  /** 返回页面 HTML；挑战未通过、硬封锁、主机熔断或加载失败返回空串 */
  browserFetch(url: string): Promise<string>
  /** 解除主机熔断（用户在数据源面板点「重试」时）；不给主机则全部解除 */
  resetBrowserFetch(host?: string): void
}

const DEFAULT_CHALLENGE_WAIT_MS = 20000
const DEFAULT_CLEARANCE_TTL_MS = 25 * 60 * 1000

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** 创建一套代抓实例。 */
export function createBrowserFetch(
  options: BrowserFetchOptions = {}
): BrowserFetcher {
  const challengeWaitMs = options.challengeWaitMs ?? DEFAULT_CHALLENGE_WAIT_MS
  const clearanceTtlMs = options.clearanceTtlMs ?? DEFAULT_CLEARANCE_TTL_MS
  const now = options.now ?? Date.now
  const clearanceCookie = options.hasClearance ?? hasClearance
  /** 窗口串行；会话直取不进队列。 */
  let queue: Promise<unknown> = Promise.resolve()
  /** 同一地址正在进行中的请求：重复请求共用结果。 */
  const pending = new Map<string, Promise<string>>()
  /**
   * 熔断（主机 + 路径类别，与引擎一致）：硬封锁立即熔断，挑战连续 3 次没过也熔断。
   * 只在内存里；重启后的拦截由引擎落盘的熔断负责（引擎熔断期内不会来请求代抓）。
   */
  const breaker = createHostBreaker({ scopeOf: pathScope, now })
  /**
   * 主机 → 窗口最近一次取到正常页的时间（此后会话里有可用的 cf_clearance）。每次过挑战换一个
   * 新对象，按引用就能分辨「进队之后有没有人重新过过」，不受时钟精度影响。
   */
  const cleared = new Map<string, { at: number }>()

  const fresh = (url: string): boolean => {
    const record = cleared.get(hostOf(url))
    return record !== undefined && now() - record.at < clearanceTtlMs
  }

  /** 值得先试会话直取：窗口刚过过挑战，或会话里还有没过期的 cf_clearance。 */
  const worthSession = async (url: string): Promise<boolean> =>
    fresh(url) || (await clearanceCookie(url, now()))

  /** 会话直取：正常页返回 HTML；挑战页作废记录、其余没取到返回 null（退回窗口）；硬封锁抛错。 */
  const viaSession = async (url: string): Promise<string | null> => {
    const page = await fetchViaSession(url)
    if (page.kind === 'ok') {
      breaker.succeed(url)
      return page.html
    }
    if (page.kind === 'blocked') throw new BlockedPageError(url)
    if (page.kind === 'challenge') cleared.delete(hostOf(url))
    return null
  }

  /**
   * 排队开窗口；轮到时再查熔断与过挑战记录：前面的请求可能刚封了主机，也可能刚让窗口过了
   * 这个主机的挑战——记录不是进队前用过的那条（tried），就先再走一次会话直取。
   */
  const viaWindow = (url: string, tried?: { at: number }): Promise<string> => {
    const task = queue.then(async () => {
      if (breaker.check(url)) return ''
      try {
        const renewed = fresh(url) && cleared.get(hostOf(url)) !== tried
        const viaCookie = renewed ? await viaSession(url) : null
        if (viaCookie !== null) return viaCookie
        const html = await fetchViaWindow(url, challengeWaitMs)
        if (isUsablePage(html)) {
          breaker.succeed(url)
          cleared.set(hostOf(url), { at: now() })
        } else breaker.fail(url, 'challenge')
        return html
      } catch (error) {
        // 在队列里处理完熔断再放行下一个，排在后面的同主机请求才看得到。
        if (error instanceof BlockedPageError) breaker.block(url)
        else breaker.fail(url)
        return ''
      }
    })
    queue = task
    return task
  }

  const run = async (url: string): Promise<string> => {
    if (!(await worthSession(url))) return viaWindow(url)
    const tried = cleared.get(hostOf(url))
    try {
      return (await viaSession(url)) ?? (await viaWindow(url, tried))
    } catch {
      // viaWindow 自己吞错，到这里的只有会话直取读到的硬封锁。
      breaker.block(url)
      return ''
    }
  }

  return {
    async browserFetch(url) {
      if (!isHttpUrl(url) || breaker.check(url)) return ''
      let task = pending.get(url)
      if (!task) {
        task = run(url).finally(() => pending.delete(url))
        pending.set(url, task)
      }
      const html = await task
      return isUsablePage(html) ? html : ''
    },
    resetBrowserFetch(host) {
      breaker.reset(host === undefined ? undefined : hostOf(host))
    },
  }
}

/** 主进程共用的一套代抓（引擎宿主方法 browserFetch / resetBrowserFetch）。 */
export const { browserFetch, resetBrowserFetch } = createBrowserFetch()
