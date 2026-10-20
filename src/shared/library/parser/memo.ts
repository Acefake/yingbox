/**
 * 有上限的单参数记忆化：媒体库里同一个文件夹名、同一个发布标记会被反复解析。
 * 超过上限时整体清空，避免长期运行时无限增长。
 */
export function memoize<T>(
  fn: (key: string) => T,
  limit = 4096
): (key: string) => T {
  const cache = new Map<string, T>()
  return (key: string): T => {
    const hit = cache.get(key)
    if (hit !== undefined || cache.has(key)) return hit as T
    if (cache.size >= limit) cache.clear()
    const value = fn(key)
    cache.set(key, value)
    return value
  }
}
