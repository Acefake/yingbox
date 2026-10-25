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
