/**
 * WebDAV / Alist 源的主进程接口（window.api.webdav）。只有桌面端有；网页端（片库服务）返回 null。
 */
import { usesLibraryServer } from '../api/bridge'

/** 桌面端的 webdav 域；网页端或旧 preload 为 null。 */
export function webdavApi(): NonNullable<typeof window.api>['webdav'] | null {
  if (usesLibraryServer()) return null
  return window.api?.webdav ?? null
}
