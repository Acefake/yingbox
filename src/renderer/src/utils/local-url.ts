import { remoteMediaUrl } from '../../../shared/webdav/remote-path'

/**
 * 将 Windows 本地路径转为 local:// URL
 * 供 <img src> 直接使用，零 IPC，浏览器直接读取本地文件
 * e.g. "F:\\foo\\poster.jpg" → "local://f/foo/poster.jpg"
 * 远程媒体库（WebDAV）的路径 yingbox-dav://… 换成编码后的同 scheme 地址，由主进程带凭据转发。
 */
export function toLocalUrl(filePath: string): string {
  if (!filePath) return ''
  const remote = remoteMediaUrl(filePath)
  if (remote) return remote
  const normalized = filePath.replace(/\\/g, '/')
  // Windows 绝对路径 "F:/..." → host=drive letter, path=rest
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch) {
    return `local://${driveMatch[1].toLowerCase()}/${driveMatch[2].split('/').map(encodeURIComponent).join('/')}`
  }
  return `local:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}
