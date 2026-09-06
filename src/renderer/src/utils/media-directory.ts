import type { FileItem } from '@/types'
import { message } from 'ant-design-vue'

export const fileId = (path: string): string => path.replace(/\\/g, '/')

export type MediaPreviousIndexEntry = {
  path: string
  mtime: number
  size: number
  name?: string
  isDirectory?: boolean
  isFile?: boolean
}

export async function readMediaDirectory(
  directory: string,
  previousIndex?: MediaPreviousIndexEntry[]
): Promise<FileItem[]> {
  const result = await window.api.file.scanMediaDirectory(directory, previousIndex)
  if (!result.success || !Array.isArray(result.data)) {
    throw new Error(result.error || '读取目录失败')
  }
  const warnings = (result as { warnings?: string[] }).warnings
  if (warnings?.length) {
    console.warn('部分目录或文件未能读取:', warnings)
    message.warning(`有 ${warnings.length} 个目录或文件读取失败，请检查权限`)
  }
  return result.data.map(entry => ({ ...entry, id: fileId(entry.path) }))
}