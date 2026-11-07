import { app } from 'electron'
import { opendir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { storage } from '../../shared/contract/storage'
import { atomicWrite } from '../file-operations'
import { implement } from '../rpc'
import { MountStore } from './mount-store'
import { assertSmbMounted, resolveMappedShare } from './network-mount'

/** 注册系统共享存储管理；使用操作系统当前的共享凭据，不创建认证会话。 */
export function registerStorage(): void {
  const file = join(app.getPath('userData'), 'storage-mounts.json')
  const store = new MountStore(
    {
      read: () =>
        readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        }),
      write: text => atomicWrite(file, text),
    },
    async path => {
      try {
        await assertSmbMounted(path, process.platform)
        const dir = await opendir(path)
        await dir.close()
      } catch {
        throw new Error(
          '无法读取共享目录，请检查网络、路径和系统的共享登录状态'
        )
      }
    },
    process.platform
  )
  implement(storage, {
    list: () => store.list(),
    save: async (_, input) =>
      store.save({
        ...input,
        path:
          process.platform === 'win32'
            ? await resolveMappedShare(input.path)
            : input.path,
      }),
    remove: (_, id) => store.remove(id),
    check: (_, id) => store.check(id),
  })
}
