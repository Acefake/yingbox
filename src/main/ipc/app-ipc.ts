import { BrowserWindow, app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import * as fs from 'fs/promises'
import * as path from 'path'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

/** 启动后检查更新（仅打包环境；失败只告警） */
export function checkForUpdatesOnStartup(): void {
  if (is.dev) return
  autoUpdater.checkForUpdates().catch(error => {
    console.warn('[Updater] check failed:', error)
  })
}

/** 窗口控制、应用信息、自动更新 */
export function registerAppIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('win:minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('win:maximize', event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('win:close', event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('win:isMaximized', event => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'))

  ipcMain.handle('app:getVersion', async () => {
    try {
      const packageJsonPath = path.join(__dirname, '../../package.json')
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
      return {
        success: true,
        data: {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          author: packageJson.author,
        },
      }
    } catch (error) {
      return { success: false, error: (error as Error).message, data: null }
    }
  })

  ipcMain.handle('update:check', async () => {
    if (is.dev) return { success: false, error: '开发环境不检查更新' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, data: result?.updateInfo ?? null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  const sendStatus = (status: unknown): void => {
    getMainWindow()?.webContents.send('update:status', status)
  }

  autoUpdater.on('checking-for-update', () => sendStatus({ status: 'checking' }))
  autoUpdater.on('update-available', info => sendStatus({ status: 'available', info }))
  autoUpdater.on('update-not-available', info =>
    sendStatus({ status: 'not-available', info })
  )
  autoUpdater.on('download-progress', progress =>
    sendStatus({ status: 'downloading', progress })
  )
  autoUpdater.on('update-downloaded', info => sendStatus({ status: 'downloaded', info }))
  autoUpdater.on('error', error => sendStatus({ status: 'error', error: error.message }))
}
