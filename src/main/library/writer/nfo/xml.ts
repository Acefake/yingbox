/**
 * NFO 用的最小 XML 工具：生成（转义、缩进）与容错读取（只切出根元素的直接子元素）。
 *
 * 不引入 XML 库：生成侧形状固定；读取侧只需要“按顶层字段切块”供合并模式使用，
 * 其他工具写的 NFO 常有手写错误、编码声明不符、根元素后跟一行网址（Kodi 的组合 NFO），
 * 这里读不懂就返回 null，由调用方按“无法合并”处理，绝不抛错。
 */

/** XML 1.0 不允许的字符：C0 控制符（除 \t \n \r）、U+FFFE / U+FFFF、孤立代理。 */
const INVALID_XML_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** 转义文本 / 属性值，并去掉 XML 不允许出现的字符。 */
export function escapeXml(text: string): string {
  return text.replace(INVALID_XML_RE, '').replace(/[&<>"']/g, c => ESCAPES[c])
}

/** 生成用的元素。text 与 children 二选一；都没有时输出空元素。 */
export interface XmlNode {
  tag: string
  attrs?: Record<string, string | number | boolean>
  text?: string | number
  children?: XmlNode[]
}

/** 有值才生成元素：空串、undefined、null、NaN 返回 undefined，便于 filter 掉。 */
export function el(
  tag: string,
  value: string | number | null | undefined,
  attrs?: XmlNode['attrs']
): XmlNode | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  return { tag, text: typeof value === 'string' ? value.trim() : value, attrs }
}

/** 带子元素的元素；没有任何子元素时返回 undefined。 */
export function group(
  tag: string,
  children: Array<XmlNode | undefined>,
  attrs?: XmlNode['attrs']
): XmlNode | undefined {
  const kept = children.filter((c): c is XmlNode => c !== undefined)
  return kept.length ? { tag, children: kept, attrs } : undefined
}

function renderAttrs(attrs: XmlNode['attrs']): string {
  if (!attrs) return ''
  return Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('')
}

/** 输出一个元素（两个空格缩进）。 */
export function renderNode(node: XmlNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  const open = `${node.tag}${renderAttrs(node.attrs)}`
  if (node.children?.length) {
    const inner = node.children.map(c => renderNode(c, depth + 1)).join('\n')
    return `${pad}<${open}>\n${inner}\n${pad}</${node.tag}>`
  }
  if (node.text === undefined || node.text === '') return `${pad}<${open} />`
  return `${pad}<${open}>${escapeXml(String(node.text))}</${node.tag}>`
}

/** XML 声明（Kodi / Jellyfin / Emby 都按 UTF-8 读）。 */
export const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

// —————————————————————————— 容错读取 ——————————————————————————

/** 根元素下的一个直接子节点（元素或注释），raw 是它在原文里的完整文本。 */
export interface RawChild {
  /** 小写标签名；注释为 '#comment'。 */
  name: string
  raw: string
}

/** 一个根元素。 */
export interface RawRoot {
  name: string
  /** 原始开始标签（含属性），合并时原样保留。 */
  openTag: string
  children: RawChild[]
}

interface TagToken {
  type: 'open' | 'close' | 'self'
  name: string
  end: number
}

/** 读 pos 处（text[pos] === '<'）的一个标签；属性值里的 `>` 不算结束。不是合法标签返回 null。 */
function readTag(text: string, pos: number): TagToken | null {
  const closing = text[pos + 1] === '/'
  const m = /^[A-Za-z_][\w.:-]*/.exec(
    text.slice(pos + (closing ? 2 : 1), pos + 200)
  )
  if (!m) return null
  let i = pos + (closing ? 2 : 1) + m[0].length
  let quote = ''
  for (; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') {
      const self = !closing && text[i - 1] === '/'
      return {
        type: closing ? 'close' : self ? 'self' : 'open',
        name: m[0].toLowerCase(),
        end: i + 1,
      }
    }
  }
  return null
}

/** 跳过 pos 处的注释 / CDATA / 处理指令 / DOCTYPE，返回其后位置；不是这些返回 -1。 */
function skipSpecial(text: string, pos: number): number {
  const pairs: Array<[string, string]> = [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
    ['<!', '>'],
  ]
  for (const [open, close] of pairs) {
    if (text.startsWith(open, pos)) {
      const end = text.indexOf(close, pos + open.length)
      return end < 0 ? text.length : end + close.length
    }
  }
  return -1
}

/** 从 pos 处的开始标签读到配对的结束标签，返回结束位置；嵌套不配对返回 -1。 */
function readElement(text: string, pos: number): number {
  const first = readTag(text, pos)
  if (!first || first.type === 'close') return -1
  if (first.type === 'self') return first.end
  const stack = [first.name]
  let i = first.end
  while (stack.length) {
    const lt = text.indexOf('<', i)
    if (lt < 0) return -1
    const special = skipSpecial(text, lt)
    if (special >= 0) {
      i = special
      continue
    }
    const tag = readTag(text, lt)
    if (!tag) {
      i = lt + 1
      continue
    }
    i = tag.end
    if (tag.type === 'open') stack.push(tag.name)
    else if (tag.type === 'close') {
      if (stack.pop() !== tag.name) return -1
    }
  }
  return i
}

/**
 * 切出全部根元素及其直接子节点。读不懂（不是 XML、标签不配对）返回 null。
 * 根元素之后的非 XML 内容（如一行网址）被忽略。
 */
export function parseRoots(input: string): RawRoot[] | null {
  const text = input.replace(/^\ufeff/, '')
  const roots: RawRoot[] = []
  let pos = 0
  while (pos < text.length) {
    const next = text.slice(pos).search(/\S/)
    if (next < 0) break
    pos += next
    if (text[pos] !== '<') break
    const special = skipSpecial(text, pos)
    if (special >= 0) {
      pos = special
      continue
    }
    const open = readTag(text, pos)
    const end = readElement(text, pos)
    if (!open || end < 0) return roots.length ? roots : null
    const root: RawRoot = {
      name: open.name,
      openTag: text.slice(pos, open.end).replace(/\s*\/>$/, '>'),
      children: [],
    }
    if (open.type === 'open') {
      let i = open.end
      const close = text.lastIndexOf('<', end - 1)
      while (i < close) {
        const lt = text.indexOf('<', i)
        if (lt < 0 || lt >= close) break
        if (text.startsWith('<!--', lt)) {
          const after = skipSpecial(text, lt)
          root.children.push({ name: '#comment', raw: text.slice(lt, after) })
          i = after
          continue
        }
        const special = skipSpecial(text, lt)
        if (special >= 0) {
          i = special
          continue
        }
        const tag = readTag(text, lt)
        const childEnd = readElement(text, lt)
        if (!tag || childEnd < 0) return null
        root.children.push({ name: tag.name, raw: text.slice(lt, childEnd) })
        i = childEnd
      }
    }
    roots.push(root)
    pos = end
  }
  return roots.length ? roots : null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** 解开实体与 CDATA。 */
export function unescapeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner: string) =>
      inner.replace(/[&<>]/g, c => ESCAPES[c])
    )
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : m
      }
      return ENTITIES[body.toLowerCase()] ?? m
    })
}

/** 简单元素的文本（去掉标签、解开实体、首尾空白）。 */
export function innerText(raw: string): string {
  const open = raw.indexOf('>')
  const close = raw.lastIndexOf('</')
  if (open < 0 || close <= open) return ''
  return unescapeXml(raw.slice(open + 1, close)).trim()
}

/** 读开始标签里的一个属性值。 */
export function attrOf(raw: string, name: string): string | undefined {
  const head = raw.slice(0, raw.indexOf('>') + 1)
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(
    head
  )
  return m ? unescapeXml(m[1] ?? m[2]) : undefined
}
