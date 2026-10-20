import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { call, defineDomain, optRecord } from './define'

/** 打开对话框的结果 */
export interface OpenDialogResult {
  success: boolean
  canceled: boolean
  filePaths: string[]
  error?: string
}

/** 保存对话框的结果 */
export interface SaveDialogResult {
  success: boolean
  canceled: boolean
  filePath: string
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
  /** 选择保存位置 */
  saveFile: call<[options?: SaveDialogOptions], SaveDialogResult>(a => [
    optRecord<SaveDialogOptions>(a[0], 'options'),
  ]),
  /** 选择目录（只返回路径，取消为 null） */
  selectDirectory: call<string | null>(),
})
