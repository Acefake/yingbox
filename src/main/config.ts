import { app } from 'electron'
import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { atomicWrite } from './file-operations'

/** 用户配置（userData/config.json），当前仅存 downloadPath */
const configPath = join(app.getPath('userData'), 'config.json')

let downloadPath = ''

export const getConfigPath = (): string => configPath

export const getDownloadPath = (): string => downloadPath

/**
 * 校验目录可写：先确认是目录，再真实写入一个临时文件并删除。
 * 比 access(W_OK) 可靠（Windows 上尤其），能提前拦住只读盘/权限不足。
 */
async function assertWritableDirectory(dir: string): Promise<void> {
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

export async function loadConfig(): Promise<void> {
  try {
    if (fsSync.existsSync(configPath)) {
      const config = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'))
      downloadPath = typeof config.downloadPath === 'string' ? config.downloadPath : ''
    }
  } catch (err) {
    console.error('Failed to load config:', err)
  }
  if (!downloadPath) return
  // 启动时只告警：目录可能被拔出/卸载，不应阻塞启动
  try {
    await assertWritableDirectory(downloadPath)
  } catch (err) {
    console.warn(
      `[Config] 下载目录当前不可用：${(err as Error).message}（${downloadPath}）`
    )
  }
}

export async function saveConfig(): Promise<void> {
  await atomicWrite(configPath, JSON.stringify({ downloadPath }, null, 2))
}

export async function setDownloadPath(dir: string): Promise<void> {
  if (typeof dir !== 'string' || !dir.trim()) throw new Error('下载目录不能为空')
  await assertWritableDirectory(dir)
  const previous = downloadPath
  downloadPath = dir
  try {
    await saveConfig()
  } catch (error) {
    downloadPath = previous
    throw error
  }
  console.log('Download path set to:', dir)
}
