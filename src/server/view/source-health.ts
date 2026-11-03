/**
 * 在线源健康检测与自动启停（ADR-0036），照桌面 use-source-refresh 的启动轮次：
 * 每次服务启动、以及用户手动点「重新检测」时，对全部源跑一遍——通的启用，不通的停用；
 * 之后搜索、选源、自动换源只用启用的源。
 *
 * - CMS：取第一页列表（ac=videolist&pg=1，8 秒超时），响应里有 list 数组才算通；
 * - 插件：后台搜一次「电影」（45 秒超时），有 list 数组（空列表也算通）才算通，熔断 / 无列表算不通；
 * - 引擎暂时不可用（调用本身抛错）是「不知道」，保留原来的状态，不因为引擎没起来就把源全关了；
 * - 一轮里一个源都没通，多半是整个设备没网，当作「不知道」，不改原状态（不会因为断网把全部源停用）；
 * - 没检测过的源按启用算（第一次检测还没跑完时不挡搜索）。结果一轮结束时统一应用并持久化，重启后立刻沿用上次的判断。
 */
import { mapWithConcurrency } from '../../shared/concurrency'
import { isAdultCatSpiderSite } from '../../shared/online/site-selection'
import { normalizeVodPayload } from '../../shared/online/vod-data'
import type { ViewSourceHealth } from '../../shared/view/source-health'
import type { CatSpiderSite } from '../../shared/online/types'
import type { SourceDeps } from './sources'

/** 同时检测几个源（与桌面相同） */
const CONCURRENCY = 6
/** CMS 列表请求的超时（毫秒） */
const CMS_TIMEOUT_MS = 8_000
/** 插件搜索的超时（毫秒） */
const PLUGIN_TIMEOUT_MS = 45_000

/** 站点名 → 上次检测是否通；持久化在用户数据里 */
export type HealthRecord = Record<string, boolean>

/** 健康结果的存取（服务端接 user_state） */
export interface HealthStore {
  read(): HealthRecord
  write(record: HealthRecord): void
}

export interface SourceHealth {
  /** 这个站点现在能不能用（没检测过的算能用） */
  usable(name: string): boolean
  /** 检测不通而被停用的站点名 */
  disabled(): string[]
  /** 当前进度与结果 */
  status(): ViewSourceHealth
  /** 对全部源重新检测一遍；已在检测中就复用那一次 */
  start(): Promise<void>
}

/** 外部数据：从存储读回的健康记录只认「名字 → 布尔」 */
export function parseHealth(raw: unknown): HealthRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  )
}

/** 带超时的等待：到点算「不通」 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('检测超时')), ms)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

/** 检测的三种结果：通、不通、不知道（引擎不可用等，保留原状态） */
type Verdict = boolean | undefined

export function createSourceHealth(
  deps: SourceDeps,
  store: HealthStore
): SourceHealth {
  let record = store.read()
  let run: Promise<void> | null = null
  let done = 0
  let total = 0

  async function checkCms(api: string): Promise<Verdict> {
    let reply: Awaited<ReturnType<SourceDeps['getJson']>>
    try {
      const url = new URL(api)
      url.searchParams.set('ac', 'videolist')
      url.searchParams.set('pg', '1')
      reply = await deps.getJson(String(url), CMS_TIMEOUT_MS)
    } catch {
      return undefined
    }
    if (!reply.success) return false
    const list = (reply.data as { list?: unknown } | null | undefined)?.list
    return Array.isArray(list)
  }

  async function checkPlugin(siteName: string): Promise<Verdict> {
    let reply: Awaited<ReturnType<SourceDeps['vod']>>
    try {
      reply = await withTimeout(
        deps.vod({
          action: 'search',
          background: true,
          siteName,
          keyword: '电影',
          page: 1,
        }),
        PLUGIN_TIMEOUT_MS
      )
    } catch (error) {
      // 自己的超时算不通；调用本身失败（引擎没起来）是不知道
      return (error as Error).message === '检测超时' ? false : undefined
    }
    if (!reply.success || reply.unavailable) return false
    const data = normalizeVodPayload(reply.data)
    const nested = normalizeVodPayload(data?.data)
    return Array.isArray(data?.list) || Array.isArray(nested?.list)
  }

  /** 引擎刚起来时站点清单可能取不到：等一下再取，最多 3 次 */
  async function listPlugins(): Promise<CatSpiderSite[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await deps.pluginSites()
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    }
    return []
  }

  async function runAll(): Promise<void> {
    const plugins = (await listPlugins())
      // 成人源不参与（与选源一致）
      .filter(site => !isAdultCatSpiderSite(site))
    const cms = deps.cmsSites()
    const results: HealthRecord = {}
    const tasks: Array<() => Promise<void>> = [
      ...cms.map(site => async () => {
        const verdict = await checkCms(site.api)
        if (verdict !== undefined) results[site.name] = verdict
      }),
      ...plugins.map(site => async () => {
        const verdict = await checkPlugin(site.name)
        if (verdict !== undefined) results[site.name] = verdict
      }),
    ]
    done = 0
    total = tasks.length
    await mapWithConcurrency(tasks, CONCURRENCY, async task => {
      await task()
      done++
    })
    // 一个源都没通，多半是整个设备没网：当作「不知道」，保留原状态，不把全部源停用
    if (!Object.values(results).some(Boolean)) return
    // 本轮没得出结论的（引擎抖了）沿用旧结果；已经不在站点清单里的丢掉
    const known = new Set([
      ...cms.map(s => s.name),
      ...plugins.map(s => s.name),
    ])
    record = Object.fromEntries(
      Object.entries({ ...record, ...results }).filter(([name]) =>
        known.has(name)
      )
    )
    store.write(record)
  }

  return {
    usable: name => record[name] !== false,
    disabled: () =>
      Object.entries(record)
        .filter(([, ok]) => !ok)
        .map(([name]) => name),
    status() {
      const failed = this.disabled()
      return {
        checking: run !== null,
        done,
        total,
        failed,
      }
    },
    start() {
      run ??= runAll()
        .catch(() => undefined)
        .finally(() => {
          run = null
        })
      return run
    },
  }
}
