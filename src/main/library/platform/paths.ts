/**
 * 片库数据目录的固定布局（两种宿主共用；单独成文件，主进程引用时不会把核心打进主进程包）。
 */
import { join } from 'node:path'

/** <dataDir>/library.db 与 <dataDir>/media（orig/ 原图、thumb/ 缩略图）。 */
export function libraryPaths(dataDir: string): {
  dbPath: string
  mediaDir: string
} {
  return {
    dbPath: join(dataDir, 'library.db'),
    mediaDir: join(dataDir, 'media'),
  }
}
