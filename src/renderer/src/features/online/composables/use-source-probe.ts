/**
 * 详情页播放源测速：每个源（站点）取第 1 集，解析成直链后交引擎 online.probeStream 测延迟与速度，
 * 同时最多 CONCURRENCY 个。结果按源域名缓存 PROBE_TTL_MS（持久化在 online_source_probes，
 * 换片、开新窗口都不必重测）。规则在 ../utils/auto-source。
 */
import { type ComputedRef, type Ref, computed, ref, toRaw } from 'vue'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { onlineApi } from '../api/online'
import {
  type ProbeCacheEntry,
  type ProbeEpisode,
  type SourceProbe,
  firstEpisode,
  freshProbe,
  isProbeCacheEntry,
  mergeProbeCache,
  probeKey,
} from '../utils/auto-source'
import type { SiteGroup } from '../utils/detail-sources'
import { resolvePlaySource } from '../utils/play-source'

const CACHE_KEY = 'online_source_probes'
/** 同时测几个源 */
const CONCURRENCY = 6

/** useSourceProbe 的返回值 */
export interface UseSourceProbeReturn {
  /** 站点名 → 测速状态 */
  probes: Ref<Record<string, SourceProbe>>
  /** 还有源在测速 */
  probing: ComputedRef<boolean>
  /** 测这些源；已测过（或缓存未过期）的跳过，force 时全部重测 */
  probeSites: (sites: readonly SiteGroup[], force?: boolean) => void
  /** 丢弃进行中的测速与结果（换片时） */
  reset: () => void
}

const readCache = (): ProbeCacheEntry[] =>
  readStoredArray<ProbeCacheEntry>(CACHE_KEY, isProbeCacheEntry)

const writeCache = (key: string, probe: SourceProbe): void => {
  const now = Date.now()
  saveStoredArray(
    CACHE_KEY,
    mergeProbeCache(readCache(), { key, probe, at: now }, now)
  )
}

/** 解析第 1 集并测速；任何一步失败都记为失败。 */
async function measure(
  siteName: string,
  episode: ProbeEpisode
): Promise<SourceProbe> {
  try {
    // 剧集来自响应式状态，插件参数先去掉 Proxy 再过 IPC
    const ext = episode.ext ? { ...toRaw(episode.ext) } : undefined
    const url = await resolvePlaySource({
      url: episode.url,
      siteName,
      ...(ext ? { ext } : {}),
    })
    if (!url) return { status: 'fail' }
    const result = await onlineApi().probeStream(url)
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

export function useSourceProbe(): UseSourceProbeReturn {
  const probes = ref<Record<string, SourceProbe>>({})
  const probing = computed(() =>
    Object.values(probes.value).some(probe => probe.status === 'pending')
  )
  /** 测速世代：换片 / 重测后丢弃旧结果 */
  let generation = 0
  const queue: (() => Promise<void>)[] = []
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

  const set = (siteName: string, probe: SourceProbe): void => {
    probes.value = { ...probes.value, [siteName]: probe }
  }

  const probeSites = (sites: readonly SiteGroup[], force = false): void => {
    if (force) {
      generation++
      queue.length = 0
    }
    const gen = generation
    const cache = force ? [] : readCache()
    const now = Date.now()
    for (const site of sites) {
      const name = site.siteName
      if (!force && probes.value[name]) continue
      const episode = firstEpisode(site.lines)
      if (!episode) {
        set(name, { status: 'fail' })
        continue
      }
      const key = probeKey(name, episode.url)
      const cached = freshProbe(cache, key, now)
      if (cached) {
        set(name, cached)
        continue
      }
      set(name, { status: 'pending' })
      queue.push(async () => {
        if (gen !== generation) return
        const result = await measure(name, episode)
        if (gen !== generation) return
        set(name, result)
        writeCache(key, result)
      })
    }
    pump()
  }

  const reset = (): void => {
    generation++
    queue.length = 0
    probes.value = {}
  }

  return { probes, probing, probeSites, reset }
}
