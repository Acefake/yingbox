import { dialog as electronDialog, shell as electronShell } from 'electron'
import { implement } from '../rpc'
import { dialog } from '../../shared/contract/dialog'
import { shell } from '../../shared/contract/shell'

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

    selectDirectory: async () => {
      try {
        const result = await electronDialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择下载目录',
        })
        if (result.canceled || result.filePaths.length === 0) return null
        return result.filePaths[0]
      } catch (error) {
        console.error('Failed to select directory:', error)
        return null
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
    openPath: async (_, filePath) => {
      const error = await electronShell.openPath(filePath)
      return { success: !error, error: error || undefined }
    },
  })
}
