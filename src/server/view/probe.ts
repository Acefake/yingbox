/**
 * 选源测速（ADR-0035）：每个站点取第 1 集，解析成直链后交引擎 online.probeStream 测首包延迟与下载速度，
 * 同时最多 CONCURRENCY 个。结果按源域名缓存 PROBE_TTL_MS，不同会话、不同片共用。
 * 规则（缓存键、排序、文案）与桌面详情页共用 shared/online/auto-source；这里只管调度与出网。
 */
import type { StreamProbe } from '../../shared/contract/online'
import {
  PROBE_TTL_MS,
  type SourceProbe,
  firstEpisode,
  probeKey,
} from '../../shared/online/auto-source'
import {
  type PlaySourceDeps,
  resolvePlaySource,
} from '../../shared/online/play-source'
import type { SiteGroup } from '../../shared/online/sources'

/** 测速要用的 I/O：解析播放地址（与开播同一套）+ 引擎测速 */
export interface ProbeDeps extends PlaySourceDeps {
  probeStream: (url: string) => Promise<StreamProbe>
}

/** 同时测几个源 */
const CONCURRENCY = 6
/** 缓存最多留多少条 */
const MAX_CACHE = 200

/** 测速调度：ensure 立刻返回当前已知的结果，没有就排队去测，测完调 onChange */
export interface Prober {
  ensure(site: SiteGroup, onChange: () => void): SourceProbe
}

export function createProber(
  deps: ProbeDeps,
  now: () => number = Date.now
): Prober {
  const results = new Map<string, { probe: SourceProbe; at: number }>()
  /** 正在测或排队的键 → 测完时要通知的回调 */
  const waiting = new Map<string, Array<() => void>>()
  const queue: Array<() => Promise<void>> = []
  let running = 0

  const pump = (): void => {
    while (running < CONCURRENCY && queue.length) {
      const job = queue.shift()
      if (!job) break
      running++
      void job().finally(() => {
        running--
        pump()
      })
    }
  }

  /** 解析第 1 集并测速；任何一步失败都记为失败 */
  async function measure(
    siteName: string,
    episode: NonNullable<ReturnType<typeof firstEpisode>>
  ): Promise<SourceProbe> {
    try {
      const url = await resolvePlaySource(
        {
          url: episode.url,
          siteName,
          ...(episode.ext ? { ext: episode.ext } : {}),
        },
        deps
      )
      if (!url) return { status: 'fail' }
      const result = await deps.probeStream(url)
      if (!result.ok)
        return {
          status: 'fail',
          ...(result.latencyMs !== undefined
            ? { latencyMs: result.latencyMs }
            : {}),
        }
      return {
        status: 'ok',
        latencyMs: result.latencyMs,
        speedBps: result.speedBps,
        ...(result.height ? { height: result.height } : {}),
      }
    } catch {
      return { status: 'fail' }
    }
  }

  return {
    ensure(site, onChange) {
      const episode = firstEpisode(site.lines)
      if (!episode) return { status: 'fail' }
      const key = probeKey(site.siteName, episode.url)
      const hit = results.get(key)
      if (hit && now() - hit.at >= 0 && now() - hit.at < PROBE_TTL_MS)
        return hit.probe
      const listeners = waiting.get(key)
      if (listeners) {
        listeners.push(onChange)
        return { status: 'pending' }
      }
      waiting.set(key, [onChange])
      queue.push(async () => {
        const probe = await measure(site.siteName, episode)
        results.delete(key)
        results.set(key, { probe, at: now() })
        while (results.size > MAX_CACHE)
          results.delete(results.keys().next().value as string)
        const done = waiting.get(key) ?? []
        waiting.delete(key)
        for (const notify of done) notify()
      })
      pump()
      return { status: 'pending' }
    },
  }
}
