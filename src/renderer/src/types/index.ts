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
}

/**
 * 电影信息接口
 */
export interface MovieInfoType {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actor?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
}