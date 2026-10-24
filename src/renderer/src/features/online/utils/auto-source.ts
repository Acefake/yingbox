/**
 * 在线自动选源的纯规则：测速缓存键与过期、源按速度排序、最快源、手动选择记录、展示文案。
 * 状态与请求在 composables/use-source-probe.ts，这里不碰网络和存储。
 */
import type { EpisodeGroup } from '../types'

/** 测速结果缓存多久：30 分钟 */
export const PROBE_TTL_MS = 30 * 60 * 1000
/** 测速缓存最多留多少条 */
export const PROBE_CACHE_MAX = 200
/** 手动选源记录最多留多少部片 */
export const PICK_MAX = 200

/** 一个源的测速状态：pending 测速中，ok 成功，fail 失败（超时 / 无法解析 / 下载不到数据） */
export interface SourceProbe {
  status: 'pending' | 'ok' | 'fail'
  latencyMs?: number
  /** 字节 / 秒 */
  speedBps?: number
  /** 画面高度 */
  height?: number
}

/** 测速缓存的一条（按源域名） */
export interface ProbeCacheEntry {
  key: string
  probe: SourceProbe
  at: number
}

/** 用户对某部片手动选过的源 */
export interface SourcePick {
  film: string
  site: string
  at: number
}

/** 一集：测速取它的地址 */
export interface ProbeEpisode {
  url: string
  ext?: Record<string, unknown>
}

/**
 * 测速缓存键：第 1 集是 http(s) 地址时按它的域名（同一 CDN 不同片共用），
 * 否则（插件的页面 id 等）按站点名。
 */
export function probeKey(siteName: string, rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:')
      return `host:${url.hostname.toLowerCase()}`
  } catch {
    // 不是完整地址：按站点名
  }
  return `site:${siteName}`
}

/** 缓存里未过期的结果；pending 不算。 */
export function freshProbe(
  entries: readonly ProbeCacheEntry[],
  key: string,
  now: number
): SourceProbe | undefined {
  const hit = entries.find(entry => entry.key === key)
  if (!hit || hit.probe.status === 'pending') return undefined
  return now - hit.at < PROBE_TTL_MS && now >= hit.at ? hit.probe : undefined
}

/** 写入一条结果：去掉同键与过期的，新的在前，最多 PROBE_CACHE_MAX 条。 */
export function mergeProbeCache(
  entries: readonly ProbeCacheEntry[],
  entry: ProbeCacheEntry,
  now: number
): ProbeCacheEntry[] {
  return [
    entry,
    ...entries.filter(
      e =>
        e.key !== entry.key &&
        now - e.at < PROBE_TTL_MS &&
        e.probe.status !== 'pending'
    ),
  ].slice(0, PROBE_CACHE_MAX)
}

/** 从存储读回的缓存条目是否完整（外部数据只信这些字段）。 */
export function isProbeCacheEntry(value: unknown): value is ProbeCacheEntry {
  const v = value as ProbeCacheEntry
  return (
    !!v &&
    typeof v.key === 'string' &&
    typeof v.at === 'number' &&
    !!v.probe &&
    (v.probe.status === 'ok' || v.probe.status === 'fail')
  )
}

/** 一个站点用来测速的那一集：第一条有剧集的线路的第 1 集。 */
export function firstEpisode(
  lines: readonly EpisodeGroup[]
): ProbeEpisode | undefined {
  for (const line of lines) {
    const ep = line.episodes?.find(item => item?.url)
    if (ep) return { url: ep.url, ...(ep.ext ? { ext: ep.ext } : {}) }
  }
  return undefined
}

/** 排序档位：成功 0、测速中 / 未测 1、失败 2。 */
const tier = (probe: SourceProbe | undefined): number =>
  probe?.status === 'ok' ? 0 : probe?.status === 'fail' ? 2 : 1

/**
 * 源按测速结果排序（稳定）：成功的按速度从快到慢、同速度延迟低的在前，
 * 然后是还没测完的，失败的放最后。
 */
export function rankSites<T extends { siteName: string }>(
  sites: readonly T[],
  probes: Readonly<Record<string, SourceProbe | undefined>>
): T[] {
  return sites
    .map((site, index) => ({ site, index, probe: probes[site.siteName] }))
    .sort((a, b) => {
      const byTier = tier(a.probe) - tier(b.probe)
      if (byTier) return byTier
      if (a.probe?.status === 'ok' && b.probe?.status === 'ok') {
        const bySpeed = (b.probe.speedBps || 0) - (a.probe.speedBps || 0)
        if (bySpeed) return bySpeed
        const byLatency =
          (a.probe.latencyMs ?? Infinity) - (b.probe.latencyMs ?? Infinity)
        if (byLatency) return byLatency
      }
      return a.index - b.index
    })
    .map(item => item.site)
}

/** 测速成功里最快的源名（没有成功的返回空串）。 */
export function fastestSite(
  sites: readonly { siteName: string }[],
  probes: Readonly<Record<string, SourceProbe | undefined>>
): string {
  const top = rankSites(sites, probes)[0]
  return top && probes[top.siteName]?.status === 'ok' ? top.siteName : ''
}

/**
 * 打开详情时默认选哪个源：该片手动选过且还在列表里的优先，否则最快的，都没有返回空串。
 */
export function preferredSite(
  sites: readonly { siteName: string }[],
  probes: Readonly<Record<string, SourceProbe | undefined>>,
  picked: string
): string {
  if (picked && sites.some(site => site.siteName === picked)) return picked
  return fastestSite(sites, probes)
}

/** 某部片手动选过的源名（没有返回空串）。 */
export function findPick(picks: readonly SourcePick[], film: string): string {
  return (film && picks.find(pick => pick.film === film)?.site) || ''
}

/** 记一次手动选择：同一部片只留最新一条，新的在前，最多 PICK_MAX 部。 */
export function mergePick(
  picks: readonly SourcePick[],
  pick: SourcePick
): SourcePick[] {
  return [pick, ...picks.filter(item => item.film !== pick.film)].slice(
    0,
    PICK_MAX
  )
}

/** 从存储读回的选择记录是否完整。 */
export function isSourcePick(value: unknown): value is SourcePick {
  const v = value as SourcePick
  return (
    !!v &&
    typeof v.film === 'string' &&
    typeof v.site === 'string' &&
    typeof v.at === 'number'
  )
}

/** 速度文案：≥1 MB/s 一位小数 MB/s，否则整数 KB/s。 */
export function formatSpeed(bps: number | undefined): string {
  if (!bps || bps <= 0) return '—'
  const mb = bps / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bps / 1024))} KB/s`
}

/** 延迟文案。 */
export function formatLatency(ms: number | undefined): string {
  return typeof ms === 'number' && ms >= 0 ? `${Math.round(ms)} ms` : '—'
}

/** 分辨率文案：按画面高度归档（4K / 1080P / 720P / 480P …），拿不到返回空串。 */
export function resolutionLabel(height: number | undefined): string {
  if (!height || height <= 0) return ''
  if (height >= 2000) return '4K'
  if (height >= 1400) return '2K'
  for (const step of [1080, 720, 480, 360])
    if (height >= step * 0.9) return `${step}P`
  return `${height}P`
}
