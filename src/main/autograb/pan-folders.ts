/**
 * 追更定位转存目标要的 115 文件夹能力（剧集追更与电影追踪共用，ADR-0029）：
 * 本地目录换算 cid、核对 cid 还在、在某个文件夹下找或建一层子文件夹。
 */
import { Pan115Error } from '../pan115/errors'
import type { Pan115Service } from '../pan115/service'
import { resolveFolderCid } from './upgrade/folder-path'

/** 115 文件夹能力 */
export interface PanFolders {
  /** 本地目录对应的 115 文件夹 cid；找不到为 null */
  folderCid(localDir: string): Promise<string | null>
  /** 文件夹 cid 在 115 上还在（列得出、且列出来的就是它自己） */
  folderExists(cid: string): Promise<boolean>
  /** 文件夹 parent 下名为 name 的子文件夹 cid，没有就建 */
  childFolder(parent: string, name: string): Promise<string>
}

/**
 * @param mountRoot 设置里的挂载根目录（library.notify.mountRoot，空串 = 没填）
 */
export function createPanFolders(
  pan115: Pick<Pan115Service, 'use'>,
  mountRoot: () => string
): PanFolders {
  return {
    folderCid: localDir =>
      pan115.use(client =>
        resolveFolderCid(localDir, mountRoot(), cid => client.dirs(cid))
      ),
    folderExists: cid =>
      pan115.use(async client => {
        try {
          const listing = await client.dirs(cid)
          return listing.path.at(-1)?.cid === cid
        } catch (error) {
          // 115 明确拒绝（state 为 false，带错误码）才算不在；网络、超时等照常抛出
          if (refused(error)) return false
          throw error
        }
      }),
    childFolder: (parent, name) =>
      pan115.use(async client => {
        const find = async (): Promise<string | undefined> => {
          const listing = await client.dirs(parent)
          const hit = listing.dirs.find(d => d.name === name)?.cid
          // 子文件夹太多没列全：不贸然新建，免得 115 再建一个同名的
          if (!hit && listing.truncated)
            throw new Pan115Error(
              `「${name}」所在的文件夹里子文件夹太多，没能确认它在不在，请在追更里直接选这部剧的文件夹`
            )
          return hit
        }
        const found = await find()
        if (found) return found
        try {
          return await client.mkdir(parent, name)
        } catch (error) {
          // 两次转存同时建同一个文件夹：另一边先建好了就用它
          const raced = await find()
          if (raced) return raced
          throw error
        }
      }),
  }
}

/** 115 接口明确拒绝（返回 state 为 false 的错误码），不是网络或超时问题 */
function refused(error: unknown): boolean {
  return (
    error instanceof Pan115Error && !error.timeout && error.code !== undefined
  )
}
