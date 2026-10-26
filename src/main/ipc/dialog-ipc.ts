import { dialog as electronDialog, shell as electronShell } from 'electron'
import { implement } from '../rpc'
import { dialog } from '../../shared/contract/dialog'
import { shell } from '../../shared/contract/shell'
import { openPathError } from './path-guards'

/** 实现 dialog / shell 两个与系统交互的小域 */
export function registerDialogIpc(): void {
  implement(dialog, {
    openDirectory: async () => {
      try {
        const result = await electronDialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择目录',
        })
        return {
          success: true,
          canceled: result.canceled,
          filePaths: result.filePaths,
        }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          canceled: true,
          filePaths: [],
        }
      }
    },

    openFile: async (_, options) => {
      try {
        const result = await electronDialog.showOpenDialog({
          properties: ['openFile'],
          title: '选择文件',
          ...options,
        })
        return {
          success: true,
          canceled: result.canceled,
          filePaths: result.filePaths,
        }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          canceled: true,
          filePaths: [],
        }
      }
    },
  })

  implement(shell, {
    // 只打开文件夹：openPath 遇到可执行文件会直接运行它
    openPath: async (_, filePath) => {
      const invalid = await openPathError(filePath)
      if (invalid) return { success: false, error: invalid }
      const error = await electronShell.openPath(filePath)
      return { success: !error, error: error || undefined }
    },
  })
}
