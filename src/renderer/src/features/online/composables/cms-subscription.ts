/**
 * 源订阅：从远程清单同步 CMS 站点，缓存到本地，启动与「一键更新」时刷新。
 * 拉取失败时沿用上次缓存，不影响内置源与自定义源。
 */
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import { getJson } from '../api/online'
import type { ApiSite } from '../types'
import {
  DEFAULT_SUBSCRIPTION_URL,
  mirrorUrls,
  parseSubscription,
  planSubscriptionSelection,
} from '../utils/subscription'
import { DEFAULT_SITES, customSites, selectedSites } from './cms-sites'
import { cmsHealth } from './cms-health'

/** 订阅地址；留空表示关闭订阅。 */
export const subscriptionUrl = useStorage(
  'online_subscription_url',
  DEFAULT_SUBSCRIPTION_URL
)
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

/**
 * 同步订阅，返回本次新增的源数量。
 * 地址为空时清空订阅源；清单为空视为失败，保留旧缓存。
 */
export const syncSubscription = async (
  isCurrent: () => boolean = () => true
): Promise<number> => {
  if (!isCurrent()) return 0
  const generation = ++syncGeneration
  const url = subscriptionUrl.value.trim()
  const current = (): boolean =>
    generation === syncGeneration &&
    isCurrent() &&
    subscriptionUrl.value.trim() === url
  const previous = subscribedSites.value.map(site => site.api)
  if (!url) {
    syncingSubscription.value = false
    previous.forEach(api => {
      selectedSites.delete(api)
      cmsHealth.remove(api)
    })
    subscribedSites.value = []
    return 0
  }
  syncingSubscription.value = true
  try {
    const response = await fetchFirst(url, current)
    if (!current()) return 0
    const known = new Set([
      ...DEFAULT_SITES.map(site => site.api),
      ...customSites.value.map(site => site.api),
    ])
    const sites = parseSubscription(response).filter(
      site => !known.has(site.api)
    )
    if (!sites.length) throw new Error('订阅里没有可用的 CMS 源')
    const plan = planSubscriptionSelection({
      previous,
      next: sites.map(site => site.api),
      selected: [...previous, ...sites.map(site => site.api)].filter(api =>
        selectedSites.has(api)
      ),
    })
    plan.enable.forEach(api => selectedSites.add(api))
    const nextApis = new Set(sites.map(site => site.api))
    previous
      .filter(api => !nextApis.has(api))
      .forEach(api => cmsHealth.remove(api))
    plan.disable.forEach(api => {
      selectedSites.delete(api)
    })
    subscribedSites.value = sites
    subscriptionSyncedAt.value = Date.now()
    return plan.enable.length
  } finally {
    if (generation === syncGeneration) syncingSubscription.value = false
  }
}
