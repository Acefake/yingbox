import { dialog as electronDialog, shell as electronShell } from 'electron'
import { setDownloadPath } from '../config'
import { implement } from '../rpc'
import { config } from '../../shared/contract/config'
import { dialog } from '../../shared/contract/dialog'
import { shell } from '../../shared/contract/shell'

/** 实现 dialog / config / shell 三个与系统交互的小域 */
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

    saveFile: async (_, options) => {
      try {
        const result = await electronDialog.showSaveDialog({
          title: '保存文件',
          ...options,
        })
        return {
          success: true,
          canceled: result.canceled,
          filePath: result.filePath ?? '',
        }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          canceled: true,
          filePath: '',
        }
      }
    },
  })

  implement(config, {
    setDownloadPath: async (_, path) => {
      await setDownloadPath(path)
    },
  })

  implement(shell, {
    openPath: async (_, filePath) => {
      const error = await electronShell.openPath(filePath)
      return { success: !error, error: error || undefined }
    },
  })
}
