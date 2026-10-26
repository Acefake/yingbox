/**
 * 渲染层访问 localStorage 的唯一入口（eslint 禁止别处直接用）。
 * 存的是数据而非设置（收藏、搜索历史、源选择、排序记忆……；设置走 features/settings）。
 * 每个函数都吞掉存储异常：隐私模式 / 配额满 / 没有 localStorage（测试、SSR）时读返回空，写返回 false。
 */

/** 存储对象；拿不到时为 null（访问 localStorage 本身也可能抛错）。 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 读一个 JSON 数组，过滤掉不合格的元素；没有或坏掉时返回 []。 */
export function readStoredArray<T>(
  key: string,
  valid: (value: unknown) => boolean = value =>
    !!value && typeof value === 'object'
): T[] {
  try {
    const data: unknown = JSON.parse(storage()?.getItem(key) || '[]')
    return Array.isArray(data) ? (data.filter(valid) as T[]) : []
  } catch {
    return []
  }
}

/** 写一个 JSON 数组；失败返回 false。 */
export function saveStoredArray(key: string, values: unknown[]): boolean {
  return writeStoredText(key, JSON.stringify(values))
}

/** 读原始字符串；没有这个键时为 null。 */
export function readStoredText(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 写原始字符串；失败返回 false。 */
export function writeStoredText(key: string, value: string): boolean {
  try {
    const target = storage()
    if (!target) return false
    target.setItem(key, value)
    return true
  } catch (error) {
    console.warn(`无法保存 ${key}:`, error)
    return false
  }
}

/** 删掉一个键。 */
export function removeStored(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // 存储不可用时没有可删的
  }
}
