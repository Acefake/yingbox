/** 115 目录适配片库的远程遍历接口；数据库只保存目录 ID 和文件名。 */
import { lookup } from 'node:dns/promises'
import { posix } from 'node:path'
import type { DriveEntry, Pan115Client } from '../../main/pan115/client'
import type { Pan115Service } from '../../main/pan115/service'
import { proxyStream } from '../../main/stream-proxy'
import { LibraryError } from '../../shared/library/ipc'
import { USER_AGENT } from '../../main/pan115/http'
import { type NetClient, createNetClient } from '../../shared/net/client'
import type { DavClient } from '../../shared/webdav/client'
import type { DavEntry } from '../../shared/webdav/propfind'
import { parseRemotePath } from '../../shared/webdav/remote-path'

export const PAN115_SOURCE = 'pan115'
const PAGE_SIZE = 200
const MAX_PAGES = 500

/** 完整分页；超出上限抛错，避免把未读取的文件误判为已删除。 */
export async function allEntries(
  client: Pan115Client,
  cid: string
): Promise<DriveEntry[]> {
  const entries: DriveEntry[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const items = await client.entries(cid, page * PAGE_SIZE)
    entries.push(...items)
    if (items.length < PAGE_SIZE) return entries
  }
  throw new Error('115 目录条目过多，请选择更小的文件夹')
}

/** 只接受专用源及数字目录 ID；其它远程源不能借此绕过媒体目录限制。 */
export function pan115Root(root: string): string | null {
  const parsed = parseRemotePath(root)
  return parsed?.sourceId === PAN115_SOURCE && /^\/\d+$/.test(parsed.path)
    ? parsed.path.slice(1)
    : null
}

export function createPan115Library(
  getService: () => Pan115Service | null,
  client?: NetClient
): {
  remote(sourceId: string): Promise<DavClient>
  checkRoot(root: string): Promise<void>
  stream(path: string, request: Request): Promise<Response>
} {
  const net =
    client ??
    createNetClient({
      fetch,
      lookup: host => lookup(host, { all: true }),
    })
  const service = (): Pan115Service => {
    const pan = getService()
    if (!pan) throw new LibraryError('invalid-params', '网盘功能未启用')
    return pan
  }
  const use = <T>(run: (client: Pan115Client) => Promise<T>): Promise<T> =>
    service().use(run)

  async function resolveDir(
    client: Pan115Client,
    path: string
  ): Promise<string> {
    const [root, ...segments] = path.split('/').filter(Boolean)
    if (
      !/^\d+$/.test(root ?? '') ||
      segments.some(s => s === '.' || s === '..')
    )
      throw new Error('115 目录路径不合法')
    let cid = root
    for (const name of segments) {
      const child = (await allEntries(client, cid)).find(
        e => e.isDir && e.name === name
      )
      if (!child) throw new Error('115 文件夹已移除，请重新扫描媒体库')
      cid = child.id
    }
    return cid
  }

  return {
    async checkRoot(root) {
      const cid = pan115Root(root)
      if (cid === null)
        throw new LibraryError('invalid-params', '115 目录路径不合法')
      try {
        await use(client => client.dirs(cid))
      } catch (error) {
        throw new LibraryError('invalid-params', (error as Error).message)
      }
    },
    async remote(sourceId) {
      if (sourceId !== PAN115_SOURCE) throw new Error('此远程源不可用')
      return {
        propfind: (path, depth, signal) =>
          use(async client => {
            signal?.throwIfAborted()
            const cid = await resolveDir(client, path)
            const self: DavEntry = {
              path,
              name: posix.basename(path),
              isDir: true,
              size: 0,
              lastModified: null,
              etag: null,
            }
            if (!depth) return [self]
            const entries = await allEntries(client, cid)
            signal?.throwIfAborted()
            return [
              self,
              ...entries
                .filter(
                  e =>
                    !/[\\/]/.test(e.name) && e.name !== '.' && e.name !== '..'
                )
                .map(e => ({
                  path: `${path}/${e.name}`,
                  name: e.name,
                  isDir: e.isDir,
                  size: e.size,
                  lastModified: null,
                  etag: null,
                })),
            ]
          }),
      }
    },
    async stream(path, request) {
      const parsed = parseRemotePath(path)
      if (parsed?.sourceId !== PAN115_SOURCE) throw new Error('此远程源不可用')
      const url = await use(async client => {
        const cid = await resolveDir(client, posix.dirname(parsed.path))
        const file = (await allEntries(client, cid)).find(
          e => !e.isDir && e.name === posix.basename(parsed.path)
        )
        if (!file?.pickCode)
          throw new Error('115 文件不存在或无法播放，请重新扫描媒体库')
        return client.downloadUrl(file.pickCode)
      })
      return proxyStream(net, url, request, {
        logFailure: () => {},
        headers: { userAgent: USER_AGENT, referer: 'https://115.com/' },
      })
    },
  }
}
