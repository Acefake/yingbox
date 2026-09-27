import { dialog, ipcMain, shell } from 'electron'
import { setDownloadPath } from '../config'

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    try {
      const result = await dialog.showOpenDialog({
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
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择下载目录',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (error) {
      console.error('Failed to select directory:', error)
      return null
    }
  })

  ipcMain.handle('dialog:openFile', async (_, options?: Electron.OpenDialogOptions) => {
    try {
      const result = await dialog.showOpenDialog({
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
  })

  ipcMain.handle('dialog:saveFile', async (_, options?: Electron.SaveDialogOptions) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '保存文件',
        ...options,
      })
      return {
        success: true,
        canceled: result.canceled,
        filePath: result.filePath,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        canceled: true,
        filePath: '',
      }
    }
  })

  ipcMain.handle('config:setDownloadPath', async (_, path: string) => {
    await setDownloadPath(path)
  })

  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })
}
