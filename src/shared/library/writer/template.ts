/**
 * 整理模板：`{title} ({year})/{title} ({year}).{ext}` 这类相对媒体库根目录的路径模板。
 *
 * 语法：`{变量}` 或 `{变量:02}`（数字补零到 2 位）；`/` 分隔目录。最后一段必须以 `.{ext}` 结尾。
 * 值在填入前先清洗（片名里的 `/`、`:` 不会变成目录或非法字符）；缺失的值填空串，
 * 再清掉因此留下的空括号和多余分隔符，例如没有集标题时 `… - S01E02 - .mkv` → `… - S01E02.mkv`。
 *
 * 纯 TS，渲染进程可以直接拿来做模板预览。
 */
import { safeSegment, sanitizeValue } from './path-safety'

/** 模板可用的变量。 */
export const TEMPLATE_VARIABLES = [
  'title',
  'originalTitle',
  'year',
  'tmdbId',
  'imdbId',
  'series',
  'season',
  'episode',
  'episodeTitle',
  'ext',
] as const

/** 模板变量名。 */
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

/** 填模板的值。episode 为数组时是一个文件含多集，渲染成 `01-E02`。 */
export type TemplateValues = Partial<
  Record<TemplateVariable, string | number | number[] | null | undefined>
>

/** 默认电影模板。 */
export const DEFAULT_MOVIE_TEMPLATE = '{title} ({year})/{title} ({year}).{ext}'

/** 默认剧集模板。 */
export const DEFAULT_TV_TEMPLATE =
  '{series} ({year})/Season {season:02}/{series} - S{season:02}E{episode:02} - {episodeTitle}.{ext}'

/** 模板的最大长度。 */
const MAX_TEMPLATE_LENGTH = 300

const TOKEN_RE = /\{([A-Za-z]+)(?::(0\d))?\}/g
const KNOWN = new Set<string>(TEMPLATE_VARIABLES)

/**
 * 校验模板，合法返回 null，否则返回给人看的原因。
 * 电影模板必须含 {title}，剧集模板必须含 {episode}，最后一段必须以 `.{ext}` 结尾。
 */
export function validateTemplate(
  template: string,
  kind: 'movie' | 'tv'
): string | null {
  const t = template.trim()
  if (!t) return '模板不能为空'
  if (t.length > MAX_TEMPLATE_LENGTH) return '模板过长'
  if (/^[\\/]|^[A-Za-z]:/.test(t)) return '模板必须是相对路径'
  const segments = t.split(/[\\/]/)
  if (segments.some(s => !s.trim() || s.trim() === '.' || s.trim() === '..')) {
    return '模板里不能有空目录名或 . / ..'
  }
  const unknown = [...t.matchAll(TOKEN_RE)].find(m => !KNOWN.has(m[1]))
  if (unknown) return `未知变量 {${unknown[1]}}`
  const stripped = t.replace(TOKEN_RE, '')
  if (/[{}]/.test(stripped))
    return '大括号不成对或格式不对（应为 {变量} 或 {变量:02}）'
  if (!/\.\{ext\}$/.test(segments.at(-1)!)) return '最后一段必须以 .{ext} 结尾'
  if (kind === 'movie' && !/\{title(?::0\d)?\}/.test(t))
    return '电影模板必须包含 {title}'
  if (kind === 'tv' && !/\{episode(?::0\d)?\}/.test(t))
    return '剧集模板必须包含 {episode}'
  return null
}

/** 一个值的文本形式：数字按宽度补零，多集用 `-E` 连接。 */
function formatValue(
  value: TemplateValues[TemplateVariable],
  width: number
): string {
  if (value === null || value === undefined) return ''
  const pad = (n: number): string => String(n).padStart(width, '0')
  if (Array.isArray(value)) return value.map(pad).join('-E')
  if (typeof value === 'number') return pad(value)
  return sanitizeValue(value)
}

/** 去掉缺值留下的空括号、重复分隔符和首尾分隔符。 */
function tidy(text: string): string {
  return text
    .replace(/\s*(?:\(\s*\)|\[\s*\]|（\s*）)/g, '')
    .replace(/(?:\s+-){2,}\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–_.]+|[\s\-–_]+$/g, '')
}

/** 渲染结果：相对路径的各段；渲染不出合法名字时给出原因。 */
export type RenderResult =
  | { ok: true; segments: string[] }
  | { ok: false; error: string }

/**
 * 渲染模板（调用方应先校验）。返回已清洗、可直接拼到媒体库根目录下的各段。
 */
export function renderTemplate(
  template: string,
  values: TemplateValues
): RenderResult {
  const raw = template.trim().split(/[\\/]/)
  const segments: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const last = i === raw.length - 1
    const body = last ? raw[i].replace(/\.\{ext\}$/, '') : raw[i]
    const filled = body.replace(TOKEN_RE, (_m, name: string, w?: string) =>
      formatValue(values[name as TemplateVariable], w ? Number(w) : 0)
    )
    const ext = last
      ? sanitizeValue(String(values.ext ?? '')).replace(/^\.+/, '')
      : ''
    const segment = safeSegment(tidy(filled), ext)
    if (!segment || (last && segment === `.${ext}`)) {
      return {
        ok: false,
        error: `模板第 ${i + 1} 段渲染为空（缺少片名等信息）`,
      }
    }
    segments.push(segment)
  }
  return { ok: true, segments }
}
