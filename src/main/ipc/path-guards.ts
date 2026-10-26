/**
 * 渲染层传进来的本地路径在 IPC 边界的校验：主进程不信任渲染层给的任意路径。
 *
 * shell:openPath 只打开文件夹（「在文件夹中显示」），不能借它让系统去执行一个程序或打开任意文件。
 * （subtitle:read 的同类校验在 subtitle.ts 的 readSubtitleAsVtt 里。）
 */
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** 校验能否交给系统打开：只接受已存在的文件夹的绝对路径；可以打开返回 null，否则返回原因 */
export async function openPathError(dirPath: string): Promise<string | null> {
  if (!dirPath || !isAbsolute(dirPath)) return '路径无效'
  try {
    if (!(await stat(dirPath)).isDirectory()) return '只能打开文件夹'
  } catch {
    return '文件夹不存在'
  }
  return null
}
