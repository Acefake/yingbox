/**
 * 下载目录：设置 `download.dir`（主进程是唯一写入者），空串表示默认目录「视频/影盒下载」。
 *
 * - {@link resolveDownloadDir}：后台引擎每次开始下载时经宿主方法 downloadDir 取实际目录
 * - {@link chooseDownloadDir}：设置页点「选择」→ 系统对话框 → 校验可写 → 写入设置
 * - {@link migrateLegacyConfig}：老版本把下载目录存在 userData/config.json，首启并入设置后删除该文件
 *
 * 依赖（对话框、存储、目录）都由调用方注入，便于单测。
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SettingsStore } from './settings/store'

/** 默认下载目录在系统「视频」文件夹下的子目录名 */
export const DEFAULT_DOWNLOAD_FOLDER = '影盒下载'

/** 设置值为空时用默认目录 */
export function resolveDownloadDir(setting: string, videosDir: string): string {
  return setting || join(videosDir, DEFAULT_DOWNLOAD_FOLDER)
}

/**
 * 校验目录可写：先确认是目录，再真实写入一个临时文件并删除。
 * 比 access(W_OK) 可靠（Windows 上尤其），能提前拦住只读盘 / 权限不足。
 */
export async function assertWritableDirectory(dir: string): Promise<void> {
  const stats = await fs.stat(dir)
  if (!stats.isDirectory()) throw new Error('下载路径必须是目录')
  const probe = join(dir, `.yingbox-write-test-${randomUUID()}`)
  try {
    await fs.writeFile(probe, '')
  } catch {
    throw new Error('下载目录不可写，请检查权限')
  } finally {
    await fs.unlink(probe).catch(() => {})
  }
}

/** 选择下载目录的依赖 */
export interface ChooseDownloadDirDeps {
  store: Pick<SettingsStore, 'get' | 'set'>
  /** 系统「视频」文件夹 */
  videosDir: string
  /** 弹出选择文件夹对话框，defaultPath 为当前实际目录；取消返回 null */
  pickFolder: (defaultPath: string) => Promise<string | null>
}

/** 让用户选一个目录作为下载目录：取消返回 null；不可写时抛错且不改设置 */
export async function chooseDownloadDir(
  deps: ChooseDownloadDirDeps
): Promise<string | null> {
  const current = resolveDownloadDir(
    deps.store.get('download.dir'),
    deps.videosDir
  )
  const picked = await deps.pickFolder(current)
  if (!picked) return null
  await assertWritableDirectory(picked)
  deps.store.set('download.dir', picked)
  return deps.store.get('download.dir')
}

/**
 * 把老版本 config.json 里的 downloadPath 并入设置（设置里已有值时不覆盖），然后删除 config.json。
 * 该文件只存过这一项；读不了或值不合法就直接丢弃，回到默认目录。
 */
export async function migrateLegacyConfig(
  store: Pick<SettingsStore, 'get' | 'set'>,
  configFile: string
): Promise<void> {
  let text: string
  try {
    text = await fs.readFile(configFile, 'utf8')
  } catch {
    return
  }
  try {
    const legacy = (JSON.parse(text) as { downloadPath?: unknown }).downloadPath
    if (typeof legacy === 'string' && legacy && !store.get('download.dir'))
      store.set('download.dir', legacy)
  } catch (error) {
    console.warn(
      '[download-dir] 旧 config.json 的下载目录无法迁移，已丢弃',
      error
    )
  }
  await fs.unlink(configFile).catch(() => {})
}
