/**
 * WebDAV PROPFIND 的请求体与 207 Multi-Status 响应解析（纯函数，不依赖 XML 库）。
 *
 * 兼容常见服务端的写法差异：命名空间前缀任意（D: / d: / lp1: / 无前缀）、href 是绝对地址或绝对路径、
 * href 编码或不编码、目录的 href 带不带结尾斜杠、找不到的属性放在 404 的 propstat 里（空元素）。
 * Alist 的 WebDAV、群晖 / 威联通 WebDAV Server、Apache mod_dav、nginx-dav-ext、rclone serve webdav 都是这种格式。
 */
import { normalizeRemotePath } from './remote-path'

/** PROPFIND 只要这几个属性，响应小、服务端也算得快。 */
export const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/>' +
  '</d:prop></d:propfind>'

/** 响应里的一项（目录本身或它的直接子项）。 */
export interface DavEntry {
  /** 相对源根目录的远程路径（解码后，以 / 开头，无结尾斜杠）。 */
  path: string
  /** 最后一段名字；源根目录为空串。 */
  name: string
  isDir: boolean
  /** 字节数；目录或服务端没给时为 0。 */
  size: number
  /** getlastmodified 的毫秒时间；没给或解析不了为 null。 */
  lastModified: number | null
  /** getetag 原文（去掉弱校验前缀和引号）；没给为 null。 */
  etag: string | null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** 解 XML 实体（命名实体与数字实体）。 */
function decodeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[body.toLowerCase()] ?? whole
    }
  )
}

/** 取某个（任意前缀的）元素的全部出现：返回内部文本；自闭合元素给空串。 */
function elements(xml: string, local: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}\\s*>)`,
    'gi'
  )
  const found: string[] = []
  for (const match of xml.matchAll(re)) found.push(match[1] ?? '')
  return found
}

/** 第一个非空的元素文本（去 CDATA、解实体、去首尾空白）。 */
function firstText(xml: string, local: string): string | null {
  for (const raw of elements(xml, local)) {
    const text = decodeXml(
      raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    ).trim()
    if (text) return text
  }
  return null
}

/** propstat 是否成功（没有 status 元素时按成功处理）。 */
function propstatOk(block: string): boolean {
  const status = firstText(block, 'status')
  return !status || /\s2\d\d(\s|$)/.test(` ${status}`)
}

/** href → 解码后的绝对路径（去掉协议与主机）；解码失败时按原文处理。 */
export function hrefPath(href: string): string {
  let path = href
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(href)
  if (absolute) path = absolute[1] ?? '/'
  path = path.replace(/[?#].*$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // 服务端没编码且带 % 的名字：保持原文
  }
  return normalizeRemotePath(path)
}

/**
 * href 的绝对路径 → 相对源根目录的路径。basePath 是源地址的路径部分（解码后，如 /dav）；
 * 不在 basePath 下的项返回 null（有的服务端会多返回上级目录）。
 */
export function relativeToBase(path: string, basePath: string): string | null {
  const base = normalizeRemotePath(basePath)
  if (base === '/') return path
  if (path === base) return '/'
  return path.startsWith(`${base}/`) ? path.slice(base.length) : null
}

/** getlastmodified（RFC 1123）→ 毫秒；解析不了为 null。 */
function parseHttpDate(text: string | null): number | null {
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/** etag 去掉 W/ 前缀与引号。 */
function cleanEtag(text: string | null): string | null {
  if (!text) return null
  const value = text.replace(/^W\//i, '').replace(/^"(.*)"$/, '$1')
  return value || null
}

/** 解析 207 响应体；basePath 见 relativeToBase。 */
export function parseMultistatus(xml: string, basePath: string): DavEntry[] {
  const entries: DavEntry[] = []
  for (const block of elements(xml, 'response')) {
    const href = firstText(block, 'href')
    if (!href) continue
    const path = relativeToBase(hrefPath(href), basePath)
    if (path === null) continue
    // 只取成功的 propstat 里的属性
    const props = elements(block, 'propstat').filter(propstatOk).join('\n')
    const source = props || block
    const isDir =
      /<(?:[\w.-]+:)?collection[\s/>]/i.test(
        elements(source, 'resourcetype').join('')
      ) || /\/$/.test(href.replace(/[?#].*$/, ''))
    const size = Number(firstText(source, 'getcontentlength') ?? 0)
    entries.push({
      path,
      name: path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1),
      isDir,
      size: isDir || !Number.isFinite(size) || size < 0 ? 0 : size,
      lastModified: parseHttpDate(firstText(source, 'getlastmodified')),
      etag: cleanEtag(firstText(source, 'getetag')),
    })
  }
  return entries
}

/**
 * 把一次 Depth: 1 的结果分成目录自己与直接子项。服务端把自己排在哪都行；
 * 子项按「父路径等于 dir」筛，夹带的孙子项或重复项丢掉。
 */
export function splitListing(
  entries: DavEntry[],
  dir: string
): { self: DavEntry | undefined; children: DavEntry[] } {
  const target = normalizeRemotePath(dir)
  let self: DavEntry | undefined
  const seen = new Set<string>()
  const children: DavEntry[] = []
  for (const entry of entries) {
    if (entry.path === target) {
      self ??= entry
      continue
    }
    const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
    if (parent !== target || seen.has(entry.path)) continue
    seen.add(entry.path)
    children.push(entry)
  }
  return { self, children }
}
