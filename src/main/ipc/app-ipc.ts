import { BrowserWindow, app as electronApp } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { networkInterfaces } from 'node:os'
import { emit, implement } from '../rpc'
import { app } from '../../shared/contract/app'
import {
  type UpdateInfo,
  type UpdateStatusEvent,
  update,
} from '../../shared/contract/update'
import { win } from '../../shared/contract/win'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
let latestStatus: UpdateStatusEvent | null = null
let latestInfo: UpdateInfo | null = null

/** 启动后检查更新（仅打包环境；失败只告警） */
export function checkForUpdatesOnStartup(): void {
  if (is.dev) return
  autoUpdater.checkForUpdates().catch(error => {
    console.warn('[Updater] check failed:', error)
  })
}

/** 实现 win / app / update 三个域，并把 electron-updater 的状态推给主窗口 */
export function registerAppIpc(
  getMainWindow: () => BrowserWindow | null
): void {
  implement(win, {
    minimize: ({ sender }) => {
      BrowserWindow.fromWebContents(sender)?.minimize()
    },
    maximize: ({ sender }) => {
      const target = BrowserWindow.fromWebContents(sender)
      if (!target) return
      if (target.isMaximized()) target.unmaximize()
      else target.maximize()
    },
    close: ({ sender }) => {
      BrowserWindow.fromWebContents(sender)?.close()
    },
    isMaximized: ({ sender }) =>
      BrowserWindow.fromWebContents(sender)?.isMaximized() ?? false,
  })

  implement(app, {
    networkIps: () => {
      const ips: string[] = []
      for (const list of Object.values(networkInterfaces())) {
        for (const net of list ?? []) {
          if (net.family === 'IPv4' && !net.internal) ips.push(net.address)
        }
      }
      return ips
    },
  })

  implement(update, {
    check: async () => {
      if (is.dev) return { success: false, error: '开发环境不检查更新' }
      try {
        const result = await autoUpdater.checkForUpdates()
        return { success: true, data: result?.updateInfo ?? null }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    download: async () => {
      try {
        await autoUpdater.downloadUpdate()
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    install: () => {
      autoUpdater.quitAndInstall(false, true)
    },
    snapshot: () => ({
      status: latestStatus,
      info: latestInfo,
      currentVersion: electronApp.getVersion(),
    }),
  })

  const sendStatus = (status: UpdateStatusEvent): void => {
    latestStatus = status
    if ('info' in status && status.status !== 'not-available') {
      const info = status.info
      latestInfo =
        status.status === 'downloaded' && latestInfo?.version === info.version
          ? {
              ...latestInfo,
              ...info,
              releaseNotes: info.releaseNotes ?? latestInfo.releaseNotes,
            }
          : info
    }
    const target = getMainWindow()
    if (target) emit(update, 'status', status, target.webContents)
  }

  autoUpdater.on('checking-for-update', () =>
    sendStatus({ status: 'checking' })
  )
  autoUpdater.on('update-available', info =>
    sendStatus({ status: 'available', info })
  )
  autoUpdater.on('update-not-available', info =>
    sendStatus({ status: 'not-available', info })
  )
  autoUpdater.on('download-progress', progress =>
    sendStatus({ status: 'downloading', progress })
  )
  autoUpdater.on('update-downloaded', info =>
    sendStatus({ status: 'downloaded', info })
  )
  autoUpdater.on('error', error =>
    sendStatus({ status: 'error', error: error.message })
  )
}
