import { call, defineDomain, str } from './define'

/** 交给操作系统处理的动作。 */
export const shell = defineDomain('shell', {
  /** 用系统文件管理器打开一个文件夹（只接受已存在的文件夹） */
  openPath: call<[filePath: string], { success: boolean; error?: string }>(
    a => [str(a[0], 'filePath')]
  ),
})
