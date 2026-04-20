/**
 * API 响应相关类型定义
 */

/**
 * IPC 通用响应接口
 */
export interface IPCResponse<T = unknown> {
  /** 操作是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 返回数据 */
  data?: T
}

/**
 * 对话框打开结果
 */
export interface DialogOpenResult {
  /** 操作是否成功 */
  success: boolean
  /** 是否取消 */
  canceled: boolean
  /** 选择的文件路径列表 */
  filePaths?: string[]
}

/**
 * 对话框保存结果
 */
export interface DialogSaveResult {
  /** 操作是否成功 */
  success: boolean
  /** 是否取消 */
  canceled: boolean
  /** 选择的文件路径 */
  filePath?: string
}

/**
 * HTTP 下载选项
 */
export interface HttpDownloadOptions {
  /** 下载 URL */
  url: string
  /** 保存路径 */
  savePath: string
  /** 超时时间（毫秒） */
  timeout?: number
}

/**
 * HTTP 下载结果
 */
export interface HttpDownloadResult {
  /** 操作是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 保存的文件路径 */
  path?: string
}

/**
 * 文件状态检查结果
 */
export interface FileExistsResult {
  /** 文件是否存在 */
  exists: boolean
}

/**
 * 文件统计信息
 */
export interface FileStatResult {
  /** 是否为目录 */
  isDirectory: boolean
  /** 是否为文件 */
  isFile: boolean
  /** 文件大小 */
  size: number
  /** 创建时间 */
  created: Date
  /** 修改时间 */
  modified: Date
}
