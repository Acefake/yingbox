/**
 * 把 CMS 源返回的 HTML 片段（简介常是 `<p>…</p>`、`&nbsp;`）转成纯文本（纯函数）。
 * 换行标签与段落结尾变成换行，其余标签去掉，常见实体与数字实体还原，多余空行合并。
 * 结果只当文本插值显示，不做 HTML 渲染，所以不需要做净化。
 */

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  middot: '·',
  hellip: '…',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      return NAMED[body.toLowerCase()] ?? whole
    }
  )
}

/** HTML 片段 → 纯文本；不含标签的文本只做实体还原与空白整理。 */
export function htmlToText(html: string): string {
  if (!html) return ''
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
