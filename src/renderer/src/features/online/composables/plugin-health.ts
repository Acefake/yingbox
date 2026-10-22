/**
 * 插件源可用性（模块级单例）：引擎回报某个源被站点拦截 / 连不上 / 插件下载失败时记下来，
 * 冷却期内搜索跳过它、数据源列表标成不可用；到期自动清除，用户也可以手动重试。
 *
 * 引擎按「主机 + 路径类别」熔断，这里按「源 + 类别」记：只有搜索被封时，分类与播放照常，
 * 搜索才跳过；不分类别的记录（插件下载失败等）对整个源生效。
 */
import { reactive } from 'vue'
import type { HostScope } from '../../../../../shared/contract/online'
import { onlineApi } from '../api/online'
import {
  type PluginHealth,
  blocksSearch,
  healthNote,
  isActive,
} from '../utils/plugin-health'

/** 「源名 类别」→ 不可用记录；只放仍在冷却期的记录。不分类别的记录类别写 all。 */
const health = reactive(new Map<string, PluginHealth>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const keyOf = (name: string, scope: HostScope | 'all'): string =>
  `${name}\u0000${scope}`
const keysOf = (name: string): string[] =>
  [...health.keys()].filter(key => key.startsWith(`${name}\u0000`))

const drop = (key: string): void => {
  health.delete(key)
  clearTimeout(timers.get(key))
  timers.delete(key)
}

/** 记一个源不可用；到期自动清除。 */
export function markPluginUnavailable(name: string, trip: PluginHealth): void {
  if (!isActive(trip, Date.now())) return
  const key = keyOf(name, trip.scope ?? 'all')
  drop(key)
  health.set(key, trip)
  timers.set(
    key,
    setTimeout(() => drop(key), trip.until - Date.now())
  )
}

/**
 * 源恢复（一次正常返回）时清掉记录：给类别只清该类别和不分类别的记录
 * （搜索成功不代表分类恢复），不给清全部。
 */
export function markPluginOk(name: string, scope?: HostScope): void {
  for (const key of keysOf(name))
    if (!scope || key === keyOf(name, scope) || key === keyOf(name, 'all'))
      drop(key)
}

/** 源当前仍生效的记录，可按条件筛选；取第一条。 */
function activeOf(
  name: string,
  pick: (value: PluginHealth) => boolean = () => true
): PluginHealth | undefined {
  const now = Date.now()
  return keysOf(name)
    .map(key => health.get(key))
    .find((value): value is PluginHealth => isActive(value, now) && pick(value))
}

/** 源当前的不可用记录（任一类别）；可用时为 undefined。 */
export function pluginHealthOf(name: string): PluginHealth | undefined {
  return activeOf(name)
}

/** 搜索时用：挡搜索的记录（搜索类或整站）；只有分类被封时为 undefined。 */
export function pluginSearchHealthOf(name: string): PluginHealth | undefined {
  return activeOf(name, blocksSearch)
}

/** 手动重试：解除引擎与浏览器代抓两边对该主机的熔断，并清掉记录。 */
export async function retryPlugin(name: string): Promise<void> {
  const hosts = new Set(keysOf(name).map(key => health.get(key)!.host))
  markPluginOk(name)
  for (const host of hosts) await onlineApi().resetBlocks(host)
}

/** 全部重试（数据源面板「一键更新」时）：解除所有熔断并清空记录。 */
export async function retryAllPlugins(): Promise<void> {
  for (const key of [...health.keys()]) drop(key)
  await onlineApi().resetBlocks()
}

/** 数据源列表里插件源一行的状态：不可用时标红、写明原因并提供「重试」。 */
export function pluginRowProps(name: string): {
  status: 'ok' | 'fail'
  note: string
  checkable: boolean
  checkLabel: string
} {
  const value = pluginHealthOf(name)
  return {
    status: value ? 'fail' : 'ok',
    note: value ? healthNote(value, Date.now()) : '',
    checkable: !!value,
    checkLabel: '重试数据源',
  }
}
