/**
 * 内置订阅（ADR-0047）：从两个固定的远程清单同步 CMS 站点，成人站归 AV 板块，
 * 缓存到本地，启动与「一键更新」时刷新。
 * 拉取失败时沿用上次缓存，不影响内置源与自定义源。
 */
import { useAvSources } from '@/features/av'
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import { getJson } from '../api/online'
import type { ApiSite } from '../types'
import {
  type ParsedSubscription,
  SUBSCRIPTION_URLS,
  mergeSites,
  mirrorUrls,
  parseSubscription,
  planSubscriptionSelection,
  siteKey,
} from '../utils/subscription'
import { DEFAULT_SITES, customSites, selectedSites } from './cms-sites'
import { cmsHealth } from './cms-health'

/** 上次同步到的订阅站点（已排除内置与自定义源里重复的地址）。 */
export const subscribedSites = useStorage<ApiSite[]>(
  'online_subscribed_sites',
  []
)
/** 上次同步成功的时间戳（毫秒），0 表示从未成功。 */
export const subscriptionSyncedAt = useStorage('online_subscription_at', 0)
export const syncingSubscription = ref(false)
let syncGeneration = 0

const fetchFirst = async (
  url: string,
  isCurrent: () => boolean
): Promise<unknown> => {
  let lastError: unknown = null
  for (const candidate of mirrorUrls(url)) {
    if (!isCurrent()) return undefined
    try {
      return await getJson(candidate, { timeoutMs: 12000 })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('订阅拉取失败')
}

/** 拉取全部内置订阅，至少一个成功即可；全部失败时抛出最后的错误。`partial` 表示有订阅失败。 */
const fetchAll = async (
  isCurrent: () => boolean
): Promise<(ParsedSubscription & { partial: boolean }) | undefined> => {
  const results = await Promise.allSettled(
    SUBSCRIPTION_URLS.map(url => fetchFirst(url, isCurrent))
  )
  if (!isCurrent()) return undefined
  const parsed = results.flatMap(result =>
    result.status === 'fulfilled' ? [parseSubscription(result.value)] : []
  )
  if (!parsed.length) {
    const failed = results.find(result => result.status === 'rejected')
    throw failed?.status === 'rejected'
      ? failed.reason
      : new Error('订阅拉取失败')
  }
  return {
    ordinary: mergeSites(...parsed.map(item => item.ordinary)),
    adult: mergeSites(...parsed.map(item => item.adult)),
    partial: parsed.length < results.length,
  }
}

/**
 * 同步订阅，返回本次新增的普通源数量。
 * 全部拉取失败或清单为空视为失败，保留旧缓存；订阅里的成人站并入 AV 板块。
 */
export const syncSubscription = async (
  isCurrent: () => boolean = () => true
): Promise<number> => {
  if (!isCurrent()) return 0
  const generation = ++syncGeneration
  const current = (): boolean => generation === syncGeneration && isCurrent()
  const previous = subscribedSites.value.map(site => site.api)
  syncingSubscription.value = true
  try {
    const parsed = await fetchAll(current)
    if (!parsed || !current()) return 0
    const known = new Set(
      [...DEFAULT_SITES, ...customSites.value].map(site => siteKey(site.api))
    )
    if (!parsed.ordinary.length) throw new Error('订阅里没有可用的 CMS 源')
    const fresh = parsed.ordinary.filter(site => !known.has(siteKey(site.api)))
    // 有订阅失败时拿到的清单不完整：保留上次缓存里还在用的站，不据此停用任何源。
    const sites = parsed.partial
      ? mergeSites(
          fresh,
          subscribedSites.value.filter(site => !known.has(siteKey(site.api)))
        )
      : fresh
    const plan = planSubscriptionSelection({
      previous,
      next: sites.map(site => site.api),
      selected: [...previous, ...sites.map(site => site.api)].filter(api =>
        selectedSites.has(api)
      ),
    })
    plan.enable.forEach(api => selectedSites.add(api))
    const nextApis = new Set(sites.map(site => site.api))
    if (!parsed.partial)
      previous
        .filter(api => !nextApis.has(api))
        .forEach(api => cmsHealth.remove(api))
    if (!parsed.partial)
      plan.disable
        .filter(api => !known.has(siteKey(api)))
        .forEach(api => selectedSites.delete(api))
    subscribedSites.value = sites
    useAvSources().addSources(parsed.adult)
    subscriptionSyncedAt.value = Date.now()
    return plan.enable.length
  } finally {
    if (generation === syncGeneration) syncingSubscription.value = false
  }
}
