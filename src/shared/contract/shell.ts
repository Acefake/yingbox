import { call, defineDomain, str } from './define'

/** 交给操作系统处理的动作。 */
export const shell = defineDomain('shell', {
  /** 用系统默认程序打开文件或目录 */
  openPath: call<[filePath: string], { success: boolean; error?: string }>(
    a => [str(a[0], 'filePath')]
  ),
})
