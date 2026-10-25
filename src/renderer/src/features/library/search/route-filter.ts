/** 面板到海报墙的条件交接：不再向模型解析，URL 中的值仍经白名单清洗。 */
import { type NlFilter, sanitizeNlFilter } from '../nl-search/nl-filter'
export function readSearchFilter(value: unknown): NlFilter | null {
  if (typeof value !== 'string' || value.length > 3000) return null
  try {
    const raw = JSON.parse(value)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return sanitizeNlFilter({
      ...raw,
      sort: raw.sort?.field,
      order: raw.sort?.order,
    })
  } catch {
    return null
  }
}

/** 路由对象替换但序列化条件未变时复用解析值，避免覆盖用户编辑。 */
export function filterReader(read: () => unknown): () => NlFilter | null {
  let previous: unknown
  let parsed: NlFilter | null = null
  return () => {
    const value = read()
    if (value !== previous) {
      previous = value
      parsed = readSearchFilter(value)
    }
    return parsed
  }
}
