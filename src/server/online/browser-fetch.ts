/**
 * 独立服务的浏览器代抓（引擎宿主方法 browserFetch）：可选，用 playwright-core 驱动系统里的 Chromium。
 *
 * - 设 YINGBOX_BROWSER=chromium:<可执行文件> 才启用；playwright-core 不是服务的依赖，运行时按需加载
 *   （镜像构建参数 WITH_CHROMIUM=1 会一起装好，见 docs/deploy/nas.md）。
 * - 没配置、加载失败或启动失败时返回空串：与桌面端「挑战没过」同一个结果，引擎按失败降级
 *   （插件源记熔断），并在日志里说明一次原因。
 * - 与桌面端 browser-fetch 同样的约束：串行（一个页面一个页面来），按主机 + 路径类别熔断，
 *   硬封锁立即熔断 30 分钟；用持久化的用户目录，cf_clearance 跨请求保留。无头浏览器过不了需要人工点的挑战。
 * - 与桌面端 network-guard.ts 一样，页面的每个请求（含跳转与子资源）都只许去公网：内网 / 本机地址直接中止，
 *   源站跳转或页面脚本不能借 NAS 上的浏览器访问局域网。
 * - 空闲 5 分钟关掉浏览器，省 NAS 内存。
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { join } from 'node:path'
import { classifyPage } from '../../shared/net/cf-page'
import { type LookupAll, assertPublicTarget } from '../../shared/net/guard'
import {
  createHostBreaker,
  hostOf,
  pathScope,
} from '../../shared/net/host-breaker'
import { CHROME_UA, isUsablePage } from '../../main/browser-fetch/page'

/** 浏览器配置。 */
export interface BrowserSpec {
  kind: 'chromium'
  /** Chromium 可执行文件 */
  path: string
}

/** 解析 YINGBOX_BROWSER；空表示不启用，不认识时抛错。 */
export function parseBrowserSpec(raw: string | undefined): BrowserSpec | null {
  const spec = (raw ?? '').trim()
  if (!spec || spec === 'off') return null
  if (spec.startsWith('chromium:') && spec.length > 9)
    return { kind: 'chromium', path: spec.slice(9) }
  throw new Error(
    `YINGBOX_BROWSER 应为 chromium:<可执行文件路径>（例如 chromium:/usr/bin/chromium）：${spec}`
  )
}

/** 用到的 playwright-core 子集（不引入它的类型依赖）。 */
interface PwPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: string }
  ): Promise<unknown>
  content(): Promise<string>
  waitForTimeout(ms: number): Promise<void>
  close(): Promise<void>
}
/** 拦下的一个请求。 */
export interface PwRoute {
  request(): { url(): string }
  continue(): Promise<void>
  abort(errorCode?: string): Promise<void>
}
interface PwContext {
  newPage(): Promise<PwPage>
  route(url: string, handler: (route: PwRoute) => Promise<void>): Promise<void>
  close(): Promise<void>
}
/** playwright-core 模块的子集。 */
export interface PlaywrightLike {
  chromium: {
    launchPersistentContext(
      dir: string,
      options: Record<string, unknown>
    ): Promise<PwContext>
  }
}

/** 代抓实例。 */
export interface NodeBrowserFetch {
  /** 返回页面 HTML；不可用、挑战没过、硬封锁或熔断中返回空串 */
  browserFetch(url: string): Promise<string>
  resetBrowserFetch(host?: string): void
  /** 启动日志里的说明 */
  describe(): string
  close(): Promise<void>
}

/** 选项。 */
export interface NodeBrowserOptions {
  spec: BrowserSpec | null
  /** 持久化用户目录的上级 */
  dataDir: string
  log: (message: string) => void
  /** 加载 playwright-core（测试注入） */
  load?: () => Promise<PlaywrightLike>
  /** DNS 解析（测试注入），公网校验用 */
  lookup?: LookupAll
  challengeWaitMs?: number
  idleMs?: number
}

const PLAYWRIGHT = 'playwright-core'
const loadPlaywright = async (): Promise<PlaywrightLike> => {
  const mod = (await import(/* @vite-ignore */ PLAYWRIGHT)) as
    | PlaywrightLike
    | { default: PlaywrightLike }
  return 'chromium' in mod ? mod : mod.default
}

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** 只放行公网请求的拦截函数；data: / blob: 等非网络地址照常放行。 */
export function publicOnlyRoute(
  lookup: LookupAll
): (route: PwRoute) => Promise<void> {
  return async route => {
    const url = route.request().url()
    if (!isHttpUrl(url)) return route.continue()
    const allowed = await assertPublicTarget(url, lookup).then(
      () => true,
      () => false
    )
    return allowed ? route.continue() : route.abort('blockedbyclient')
  }
}

/** 创建代抓。 */
export function createNodeBrowserFetch(
  options: NodeBrowserOptions
): NodeBrowserFetch {
  const { spec, log } = options
  const waitMs = options.challengeWaitMs ?? 20_000
  const idleMs = options.idleMs ?? 5 * 60_000
  const breaker = createHostBreaker({ scopeOf: pathScope })
  const lookup: LookupAll =
    options.lookup ?? (host => dnsLookup(host, { all: true }))
  let context: Promise<PwContext> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let warned = false

  const unavailable = (reason: string): string => {
    if (!warned)
      log(`浏览器代抓不可用：${reason}；被 Cloudflare 拦下的源按失败处理`)
    warned = true
    return ''
  }

  const close = async (): Promise<void> => {
    clearTimeout(idleTimer)
    const current = context
    context = null
    if (current) await current.then(c => c.close()).catch(() => {})
  }

  const open = (): Promise<PwContext> => {
    context ??= (options.load ?? loadPlaywright)()
      .then(async pw => {
        const ctx = await pw.chromium.launchPersistentContext(
          join(options.dataDir, 'browser'),
          {
            executablePath: spec!.path,
            headless: true,
            userAgent: CHROME_UA,
            // 容器里以普通用户运行、没有 user namespace，Chromium 沙箱起不来；/dev/shm 常只有 64 MB
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
          }
        )
        await ctx.route('**/*', publicOnlyRoute(lookup))
        return ctx
      })
      .catch((error: unknown) => {
        context = null
        throw error
      })
    return context
  }

  const render = async (url: string): Promise<string> => {
    const page = await (await open()).newPage()
    try {
      await page.goto(url, { timeout: waitMs, waitUntil: 'domcontentloaded' })
      const deadline = Date.now() + waitMs
      for (;;) {
        const html = await page.content()
        const verdict = classifyPage(html)
        if (verdict === 'blocked') {
          breaker.block(url)
          return ''
        }
        if (verdict === 'ok' && isUsablePage(html)) {
          breaker.succeed(url)
          return html
        }
        if (Date.now() >= deadline) {
          breaker.fail(url, 'challenge')
          return ''
        }
        await page.waitForTimeout(1000)
      }
    } finally {
      await page.close().catch(() => {})
    }
  }

  return {
    async browserFetch(url) {
      if (!spec) return unavailable('未设置 YINGBOX_BROWSER')
      if (!isHttpUrl(url) || breaker.check(url)) return ''
      const target = await assertPublicTarget(url, lookup).catch(() => null)
      if (!target) return ''
      clearTimeout(idleTimer)
      const task = queue.then(async () => {
        if (breaker.check(url)) return ''
        try {
          return await render(url)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (/Cannot find (module|package)/i.test(message))
            return unavailable(`没有安装 ${PLAYWRIGHT}`)
          log(`浏览器代抓失败（${hostOf(url)}）：${message.split('\n')[0]}`)
          breaker.fail(url)
          return ''
        }
      })
      queue = task.catch(() => '')
      const html = await task
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => void close(), idleMs)
      idleTimer.unref?.()
      return html
    },
    resetBrowserFetch(host) {
      breaker.reset(host === undefined ? undefined : hostOf(host))
    },
    describe: () =>
      spec
        ? `Chromium（${spec.path}，经 ${PLAYWRIGHT}）`
        : '未启用（YINGBOX_BROWSER 未设置）',
    close,
  }
}
