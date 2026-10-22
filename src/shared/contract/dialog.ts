import type { OpenDialogOptions } from 'electron'
import { call, defineDomain, optRecord } from './define'

/** 打开对话框的结果 */
export interface OpenDialogResult {
  success: boolean
  canceled: boolean
  filePaths: string[]
  error?: string
}

/** 系统对话框。 */
export const dialog = defineDomain('dialog', {
  /** 选择目录（返回完整结果） */
  openDirectory: call<OpenDialogResult>(),
  /** 选择文件 */
  openFile: call<[options?: OpenDialogOptions], OpenDialogResult>(a => [
    optRecord<OpenDialogOptions>(a[0], 'options'),
  ]),
})
