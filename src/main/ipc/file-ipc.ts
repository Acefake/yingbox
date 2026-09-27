import { ipcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { atomicWrite, movePath } from '../file-operations'
import { scanMediaDirectory } from '../media-scanner'

/** 读取图片为 data URL 的大小上限，避免大图把主进程内存打爆 */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

export function registerFileIpc(): void {
  ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
      await atomicWrite(filePath, content)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
      await fs.unlink(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath)
      return { success: true, exists: true }
    } catch {
      return { success: true, exists: false }
    }
  })

  ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:readdir', async (_, dirPath: string) => {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true })
      const result = files.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        isFile: file.isFile(),
      }))
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 媒体库扫描：在主进程一次完成遍历，避免渲染层对每个文件进行 IPC 往返。
  ipcMain.handle(
    'file:scanMediaDirectory',
    async (
      _,
      dirPath: string,
      previousIndex?: Array<{
        path: string
        mtime: number
        size: number
        name?: string
        isDirectory?: boolean
        isFile?: boolean
      }>
    ) => {
      try {
        return { success: true, ...(await scanMediaDirectory(dirPath, previousIndex)) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('file:stat', async (_, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)
      return {
        success: true,
        data: {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          mtime: stats.mtime,
          ctime: stats.ctime,
        },
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:readImage', async (_, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) throw new Error('目标不是文件')
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new Error(
          `图片过大（${(stats.size / 1024 / 1024).toFixed(1)}MB），上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`
        )
      }
      const data = await fs.readFile(filePath)
      return { success: true, data: `data:${imageMimeType(filePath)};base64,${data.toString('base64')}` }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:copy', async (_, srcPath: string, destPath: string) => {
    try {
      await fs.copyFile(srcPath, destPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'file:move',
    async (_, srcPath: string, destPath: string, options?: { replace?: boolean }) => {
      try {
        await movePath(srcPath, destPath, options?.replace === true)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('path:join', (_, ...paths: string[]) => path.join(...paths))

  ipcMain.handle('path:resolve', (_, ...paths: string[]) => path.resolve(...paths))

  ipcMain.handle('path:dirname', (_, filePath: string) => path.dirname(filePath))

  ipcMain.handle('path:basename', (_, filePath: string, ext?: string) =>
    path.basename(filePath, ext)
  )

  ipcMain.handle('path:extname', (_, filePath: string) => path.extname(filePath))
}
