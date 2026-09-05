/**
 * 将 Windows 本地路径转为 local:// URL
 * 供 <img src> 直接使用，零 IPC，浏览器直接读取本地文件
 * e.g. "F:\\foo\\poster.jpg" → "local://f/foo/poster.jpg"
 */
export function toLocalUrl(filePath: string): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/')
  // Windows 绝对路径 "F:/..." → host=drive letter, path=rest
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch) {
    return `local://${driveMatch[1].toLowerCase()}/${driveMatch[2].split('/').map(encodeURIComponent).join('/')}`
  }
  return `local:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}
