/**
 * 用户不再使用的在线站点（站点名列表）：选源、搜索、自动换源都跳过它们。
 * 纯规则：外部数据（存储里读回的 JSON）只认字符串，去重，数量封顶。
 */

/** 最多屏蔽多少个站点 */
export const BLOCKED_MAX = 200

/** 存储里读回的值 → 站点名列表（非字符串、空串丢掉，去重保序） */
export function parseBlocked(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names = raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
  return [...new Set(names)].slice(0, BLOCKED_MAX)
}

/** 屏蔽 / 恢复一个站点；返回新的列表（没有变化时返回同一个数组） */
export function setBlocked(
  list: readonly string[],
  name: string,
  on: boolean
): string[] {
  const site = name.trim()
  if (!site) return [...list]
  const has = list.includes(site)
  if (on === has) return [...list]
  return on ? [...list, site].slice(-BLOCKED_MAX) : list.filter(n => n !== site)
}
