/**
 * 插件源可用性（模块级单例）：引擎回报某个源被站点拦截 / 连不上 / 插件下载失败时记下来，
 * 冷却期内搜索跳过它、数据源列表标成不可用；到期自动清除，用户也可以手动重试。
 */
import { reactive } from 'vue'
import { onlineApi } from '../api/online'
import { type PluginHealth, healthNote, isActive } from '../utils/plugin-health'

/** 站点名 → 不可用记录；只放仍在冷却期的记录。 */
const health = reactive(new Map<string, PluginHealth>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const clearTimer = (name: string): void => {
  clearTimeout(timers.get(name))
  timers.delete(name)
}

/** 记一个源不可用；到期自动清除。 */
export function markPluginUnavailable(name: string, trip: PluginHealth): void {
  if (!isActive(trip, Date.now())) return
  health.set(name, trip)
  clearTimer(name)
  timers.set(
    name,
    setTimeout(() => {
      health.delete(name)
      timers.delete(name)
    }, trip.until - Date.now())
  )
}

/** 源恢复（一次正常返回）时清掉记录。 */
export function markPluginOk(name: string): void {
  if (!health.has(name)) return
  health.delete(name)
  clearTimer(name)
}

/** 源当前的不可用记录；可用时为 undefined。 */
export function pluginHealthOf(name: string): PluginHealth | undefined {
  const value = health.get(name)
  return isActive(value, Date.now()) ? value : undefined
}

/** 手动重试：解除引擎与浏览器代抓两边对该主机的熔断，并清掉记录。 */
export async function retryPlugin(name: string): Promise<void> {
  const value = health.get(name)
  markPluginOk(name)
  if (value) await onlineApi().resetBlocks(value.host)
}

/** 全部重试（数据源面板「一键更新」时）：解除所有熔断并清空记录。 */
export async function retryAllPlugins(): Promise<void> {
  for (const name of [...health.keys()]) markPluginOk(name)
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
