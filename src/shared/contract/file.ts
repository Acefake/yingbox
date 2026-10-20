import { call, defineDomain, optRecord, str } from './define'

/** 文件操作的统一结果（沿用旧形状，渲染层按 success 分支） */
export interface FileResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

/** 文件系统：读写、目录、移动。 */
export const file = defineDomain('file', {
  /** 以 UTF-8 读取文本文件 */
  read: call<[filePath: string], FileResult>(a => [str(a[0], 'filePath')]),
  /** 原子写入文本文件 */
  write: call<[filePath: string, content: string], FileResult>(a => [
    str(a[0], 'filePath'),
    str(a[1], 'content'),
  ]),
  /** 删除文件 */
  delete: call<[filePath: string], FileResult>(a => [str(a[0], 'filePath')]),
  /** 文件或目录是否存在（结果在 exists 字段） */
  exists: call<[filePath: string], FileResult>(a => [str(a[0], 'filePath')]),
  /** 递归创建目录 */
  mkdir: call<[dirPath: string], FileResult>(a => [str(a[0], 'dirPath')]),
  /** 列出目录项 */
  readdir: call<[dirPath: string], FileResult>(a => [str(a[0], 'dirPath')]),
  /** 文件元信息 */
  stat: call<[filePath: string], FileResult>(a => [str(a[0], 'filePath')]),
  /** 复制文件 */
  copy: call<[srcPath: string, destPath: string], FileResult>(a => [
    str(a[0], 'srcPath'),
    str(a[1], 'destPath'),
  ]),
  /** 移动文件；replace 为 true 时覆盖目标 */
  move: call<
    [srcPath: string, destPath: string, options?: { replace?: boolean }],
    FileResult
  >(a => [
    str(a[0], 'srcPath'),
    str(a[1], 'destPath'),
    optRecord<{ replace?: boolean }>(a[2], 'options'),
  ]),
  /** 读取本地图片为 data URL（上限 16MB） */
  readImage: call<[filePath: string], FileResult>(a => [str(a[0], 'filePath')]),
})
