/**
 * 站点解析共用的小工具：取文本、拼绝对地址、过滤占位图、时长 / 日期换算、Next.js 内嵌数据。
 * 纯函数，不发请求。
 */

/** 压缩空白并去首尾空格；空串返回 undefined。 */
export function clean(text: string | undefined | null): string | undefined {
  const value = text?.replace(/\s+/g, ' ').trim()
  return value ? value : undefined
}

/** 相对地址 → 绝对地址（支持 //host/path）；不合法返回 undefined。 */
export function absolute(
  base: string,
  href: string | undefined
): string | undefined {
  const value = href?.trim()
  if (!value) return undefined
  try {
    return new URL(value, base).toString()
  } catch {
    return undefined
  }
}

/** 站点的“暂无图片”占位图。 */
export function isPlaceholder(url: string): boolean {
  return /nowprinting|noimage|no_image|printing\.gif/i.test(url)
}

/** 去重保序，去掉空值。 */
export function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))]
}

/**
 * 时长 → 分钟：「120分鐘」「120 min」取数字；「1:49:00」「53:17」按时钟换算（后者是 分:秒）。
 */
export function minutesOf(text: string | undefined): number | undefined {
  if (!text) return undefined
  const clock = /(\d+):(\d{2})(?::(\d{2}))?/.exec(text)
  if (clock) {
    const [h, m] =
      clock[3] !== undefined
        ? [Number(clock[1]), Number(clock[2])]
        : [0, Number(clock[1])]
    const total = h * 60 + m
    return total > 0 ? total : undefined
  }
  const n = /(\d+)/.exec(text)
  return n && Number(n[1]) > 0 ? Number(n[1]) : undefined
}

/** 日期 → YYYY-MM-DD：认 2022-08-19、2023/08/10、2023.8.1。 */
export function dateOf(text: string | undefined): string | undefined {
  const m = text && /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text)
  if (!m) return undefined
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

/** JS Date.toString() 形态（"Fri Aug 19 2022 09:00:00 GMT+0900 …"）→ YYYY-MM-DD，只取字面日期不换时区。 */
export function jsDateOf(text: string | undefined): string | undefined {
  const m = text && /([A-Za-z]{3}) (\d{1,2}) (\d{4})/.exec(text)
  if (!m) return undefined
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
  if (!month) return undefined
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** 取 Next.js 页面内嵌的 props.pageProps；没有或坏数据返回 undefined。 */
export function nextPageProps(
  html: string
): Record<string, unknown> | undefined {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return undefined
  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: unknown } }
    const props = data.props?.pageProps
    return props && typeof props === 'object'
      ? (props as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** 取对象上的非空字符串字段。 */
export function str(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const value = (obj as Record<string, unknown>)[key]
  return typeof value === 'string' ? clean(value) : undefined
}

/** 取对象上的数组字段（只留对象元素）。 */
export function list(
  obj: unknown,
  key: string
): Array<Record<string, unknown>> {
  if (!obj || typeof obj !== 'object') return []
  const value = (obj as Record<string, unknown>)[key]
  return Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object'
      )
    : []
}
