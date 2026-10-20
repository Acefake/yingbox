/**
 * 跨平台安全的文件名：去掉 Windows 非法字符与控制字符、避开保留名、去掉结尾的点和空格，
 * 并按 UTF-8 字节数截断。整理（改名移动）生成的每一段路径都经过这里。
 *
 * 规则按最严格的 Windows（NTFS / SMB）来，macOS / Linux / NAS 上同样合法，
 * 这样同一个媒体库换平台访问也不会出现打不开的文件名。
 */

/** 单段文件名的字节上限（NTFS / ext4 / APFS 都是 255）。 */
export const MAX_SEGMENT_BYTES = 255

/** Windows 设备保留名（不区分大小写，带不带扩展名都不行）。 */
const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i

/** 控制字符（C0 与 DEL）。 */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g

/**
 * 清洗要填进文件名的一个值（片名、集标题……）：
 * - `Mission: Impossible` 的冒号变成 ` - `，其他冒号变 `-`；
 * - 路径分隔符与 `|` 变 `-`，双引号变单引号；
 * - `< > ? *` 与控制字符删除；
 * - 连续空白压成一个空格。
 */
export function sanitizeValue(value: string): string {
  return value
    .replace(CONTROL_RE, '')
    .replace(/\s*:\s+/g, ' - ')
    .replace(/:/g, '-')
    .replace(/[\\/|]/g, '-')
    .replace(/"/g, "'")
    .replace(/[<>?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按 UTF-8 字节数截断，不切断多字节字符与代理对。 */
export function truncateBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return text
  let bytes = 0
  let end = 0
  for (const char of text) {
    const size = encoder.encode(char).length
    if (bytes + size > maxBytes) break
    bytes += size
    end += char.length
  }
  return text.slice(0, end)
}

/**
 * 把一段文件名（不含扩展名）整理成合法名字：去掉 Windows 不允许的结尾点 / 空格，
 * 保留名后加下划线，并把“名字 + 扩展名”限制在 255 字节内。空名字返回空串，由调用方报错。
 */
export function safeSegment(base: string, ext = ''): string {
  const suffix = ext ? `.${ext}` : ''
  let name = sanitizeValue(base).replace(/[. ]+$/, '')
  name = truncateBytes(
    name,
    MAX_SEGMENT_BYTES - new TextEncoder().encode(suffix).length
  ).replace(/[. ]+$/, '')
  if (!name) return ''
  if (RESERVED_RE.test(name) || RESERVED_RE.test(`${name}${suffix}`)) {
    name = `${name}_`
  }
  return `${name}${suffix}`
}
