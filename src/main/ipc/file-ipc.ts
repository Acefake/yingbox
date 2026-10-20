import * as fs from 'fs/promises'
import * as path from 'path'
import { atomicWrite, movePath } from '../file-operations'
import { implement } from '../rpc'
import { file } from '../../shared/contract/file'
import { path as pathContract } from '../../shared/contract/path'

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

/** 实现 file / path 两个域 */
export function registerFileIpc(): void {
  implement(file, {
    read: async (_, filePath) => {
      try {
        return { success: true, data: await fs.readFile(filePath, 'utf-8') }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    write: async (_, filePath, content) => {
      try {
        await atomicWrite(filePath, content)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    delete: async (_, filePath) => {
      try {
        await fs.unlink(filePath)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    exists: async (_, filePath) => {
      try {
        await fs.access(filePath)
        return { success: true, exists: true }
      } catch {
        return { success: true, exists: false }
      }
    },
    mkdir: async (_, dirPath) => {
      try {
        await fs.mkdir(dirPath, { recursive: true })
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    readdir: async (_, dirPath) => {
      try {
        const files = await fs.readdir(dirPath, { withFileTypes: true })
        const data = files.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        }))
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    stat: async (_, filePath) => {
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
    },
    readImage: async (_, filePath) => {
      try {
        const stats = await fs.stat(filePath)
        if (!stats.isFile()) throw new Error('目标不是文件')
        if (stats.size > MAX_IMAGE_BYTES) {
          throw new Error(
            `图片过大（${(stats.size / 1024 / 1024).toFixed(1)}MB），上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`
          )
        }
        const data = await fs.readFile(filePath)
        return {
          success: true,
          data: `data:${imageMimeType(filePath)};base64,${data.toString('base64')}`,
        }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    copy: async (_, srcPath, destPath) => {
      try {
        await fs.copyFile(srcPath, destPath)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    move: async (_, srcPath, destPath, options) => {
      try {
        await movePath(srcPath, destPath, options?.replace === true)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
  })

  implement(pathContract, {
    join: (_, ...paths) => path.join(...paths),
    resolve: (_, ...paths) => path.resolve(...paths),
    dirname: (_, filePath) => path.dirname(filePath),
    basename: (_, filePath, ext) => path.basename(filePath, ext),
    extname: (_, filePath) => path.extname(filePath),
  })
}
