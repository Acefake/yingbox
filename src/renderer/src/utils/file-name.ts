/** A display title is not a filesystem path. Keep the original title in metadata. */
export function safeFileName(title: string, fallback = '未命名'): string {
  let name = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim())
    .slice(0, 80).join('').replace(/[. ]+$/g, '')
  if (!name || name === '.' || name === '..') name = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return name
}
