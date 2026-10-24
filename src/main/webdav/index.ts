/**
 * WebDAV / Alist 媒体库源接到 Electron：源存储（userData/webdav-sources.json，密码 safeStorage 加密）、
 * webdav 契约域（增删改、测试连接、列目录）、yingbox-dav 协议（内置播放器）、mpv 本机代理，
 * 以及给媒体库引擎的代办方法 webdavAccess（扫描前取凭据）。
 *
 * 局域网 NAS 是内网地址，这里的请求用 Node fetch 直连，不走 http-client 的 SSRF 防护
 * （地址是用户自己填的源，不是网页给的链接）。
 */
import { app, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpvOpenOptions } from '../../shared/mpv'
import { webdav } from '../../shared/contract/webdav'
import { DavError, createDavClient } from '../../shared/webdav/client'
import { splitListing } from '../../shared/webdav/propfind'
import {
  REMOTE_SCHEME,
  isRemotePath,
  normalizeRemotePath,
} from '../../shared/webdav/remote-path'
import { atomicWrite } from '../file-operations'
import { implement } from '../rpc'
import { safeStorageCodec } from '../settings/secrets'
import {
  type MpvProxy,
  createMpvProxy,
  createRemoteMediaHandler,
} from './proxy'
import { WebDavSourceStore } from './source-store'

/** yingbox-dav 协议的权限：标准 scheme、可流式（Range）、绕过 CSP（同 local://）。 */
export const REMOTE_SCHEME_PRIVILEGES = {
  scheme: REMOTE_SCHEME,
  privileges: {
    secure: true,
    standard: true,
    stream: true,
    bypassCSP: true,
    supportFetchAPI: true,
  },
} as const

/** 测试连接成功的提示。 */
const probeText = (dirs: number): string =>
  dirs
    ? `连接成功，根目录下有 ${dirs} 个文件夹`
    : '连接成功，根目录下没有文件夹'

const nodeFetch = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, init)

let store: WebDavSourceStore | null = null
let mpvProxy: MpvProxy | null = null

/** 源存储（第一次用到时打开）。 */
function sources(): WebDavSourceStore {
  if (!store) {
    const file = join(app.getPath('userData'), 'webdav-sources.json')
    store = new WebDavSourceStore(
      {
        read: () =>
          readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          }),
        write: text => atomicWrite(file, text),
      },
      safeStorageCodec
    )
  }
  return store
}

/** 媒体库引擎的代办方法（交给 registerLibraryIpc）。 */
export const webdavHostMethods = {
  webdavAccess: (sourceId: string) => sources().access(sourceId),
}

/** 列一个目录下的文件夹。 */
async function listFolders(
  access: Parameters<typeof createDavClient>[0],
  path: string
): Promise<{ ok: true; dirs: string[] } | { ok: false; message: string }> {
  try {
    const dir = normalizeRemotePath(path)
    const entries = await createDavClient(access, nodeFetch).propfind(dir, 1)
    const { children } = splitListing(entries, dir)
    const dirs = children
      .filter(e => e.isDir && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    return { ok: true, dirs }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DavError
          ? error.message
          : `连接失败：${(error as Error).message}`,
    }
  }
}

/** mpv 打开前：把远程路径换成本机代理地址（播放列表逐项换）。 */
export async function withMpvTargets(
  options: MpvOpenOptions
): Promise<MpvOpenOptions> {
  const proxied = async (path: string | undefined): Promise<string | null> => {
    if (!path || !isRemotePath(path)) return null
    mpvProxy ??= createMpvProxy(id => sources().access(id), nodeFetch)
    return mpvProxy.urlFor(path)
  }
  const swap = async <T extends { filePath?: string; url?: string }>(
    entry: T
  ): Promise<T> => {
    const url = await proxied(entry.filePath)
    if (!url) return entry
    const { filePath: _, ...rest } = entry
    return { ...rest, url } as T
  }
  const next = await swap(options)
  if (options.playlist)
    next.playlist = await Promise.all(options.playlist.map(swap))
  return next
}

/** 注册协议与契约域；须在 app ready 之后、创建窗口之前调用。 */
export function registerWebDav(): void {
  protocol.handle(
    REMOTE_SCHEME,
    createRemoteMediaHandler(id => sources().access(id), nodeFetch)
  )
  implement(webdav, {
    list: () => sources().list(),
    save: (_, input) => sources().save(input),
    remove: (_, id) => sources().remove(id),
    test: async (_, input) => {
      const access = await sources().accessFor(input)
      const result = await listFolders(access, '/')
      return result.ok
        ? {
            ok: true,
            message: probeText(result.dirs.length),
            dirs: result.dirs,
          }
        : { ok: false, message: result.message, dirs: [] }
    },
    listDirs: async (_, id, path) => {
      const access = await sources().access(id)
      if (!access) return { ok: false, message: '这个源已经被删除', dirs: [] }
      const result = await listFolders(access, path)
      return result.ok
        ? { ok: true, message: '', dirs: result.dirs }
        : { ok: false, message: result.message, dirs: [] }
    },
  })
  app.on('will-quit', () => void mpvProxy?.close())
}
