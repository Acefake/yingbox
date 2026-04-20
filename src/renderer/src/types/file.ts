/**
 * 文件相关类型定义
 */

/**
 * 文件项接口
 */
export interface FileItem {
  /** 文件名 */
  name: string
  /** 完整路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 是否为目录 */
  isDirectory: boolean
  /** 是否为文件 */
  isFile: boolean
  /** 修改时间（时间戳） */
  mtime?: number
}

/**
 * 处理后的项目接口
 */
export interface ProcessedItem {
  /** 项目名称 */
  name: string
  /** 项目路径 */
  path: string
  /** 项目类型 */
  type: 'folder' | 'video'
  /** 项目大小（字节） */
  size?: number
  /** 子文件数量 */
  fileCount?: number
  /** 子文件列表 */
  files?: FileItem[]
}

/**
 * 文件操作结果接口
 */
export interface FileResult<T = unknown> {
  /** 操作是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 返回数据 */
  data?: T
}

/**
 * 目录读取结果
 */
export interface DirectoryReadResult {
  /** 文件列表 */
  files: FileItem[]
  /** 目录路径 */
  path: string
}
