/**
 * 写死的内置 CMS 清单到订阅快照的一次性迁移规则（ADR-0047），按归一化站点键比较。
 */
import type { ApiSite } from '../types'
import { siteKey } from './subscription'

/**
 * 迁移后的启用列表：
 * - 与快照同键的已启用站，改用快照里的 api 写法；
 * - 旧内置站不在快照 / 自定义 / 订阅缓存里的，清掉；
 * - 快照里此前从未出现过（不在旧内置、也不在订阅缓存）的站，默认启用。
 */
export const planBuiltinMigration = (input: {
  selected: string[]
  legacy: readonly string[]
  subscribed: ApiSite[]
  defaults: ApiSite[]
  custom: ApiSite[]
}): string[] => {
  const legacyKeys = new Set(input.legacy.map(siteKey))
  const subscribedKeys = new Set(
    input.subscribed.map(site => siteKey(site.api))
  )
  const defaultByKey = new Map(
    input.defaults.map(site => [siteKey(site.api), site.api])
  )
  const customKeys = new Set(input.custom.map(site => siteKey(site.api)))
  const next: string[] = []
  for (const api of input.selected) {
    const key = siteKey(api)
    if (defaultByKey.has(key)) next.push(defaultByKey.get(key) ?? api)
    else if (customKeys.has(key) || subscribedKeys.has(key)) next.push(api)
    else if (!legacyKeys.has(key)) next.push(api)
  }
  for (const [key, api] of defaultByKey) {
    if (!legacyKeys.has(key) && !subscribedKeys.has(key)) next.push(api)
  }
  return Array.from(new Set(next))
}
