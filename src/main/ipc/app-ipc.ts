import { BrowserWindow, app as electronApp } from 'electron'
import { is } from '@electron-toolkit/utils'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { emit, implement } from '../rpc'
import { app } from '../../shared/contract/app'
import {
  type UpdateInfo,
  type UpdateStatusEvent,
  update,
} from '../../shared/contract/update'
import { win } from '../../shared/contract/win'
import { settingsStore } from '../settings'
import { createDesktopUpdater } from '../updater/desktop-updater'

let latestStatus: UpdateStatusEvent | null = null
let latestInfo: UpdateInfo | null = null

/** 自动检查更新的间隔 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 启动后检查一次更新，之后每 6 小时检查一次（仅打包环境；失败只告警） */
export function checkForUpdatesOnStartup(): void {
  if (is.dev) return
  void updater().check()
  setInterval(() => void updater().check(), CHECK_INTERVAL_MS).unref()
}

/** 应用退出时把已下载的更新静默装上 */
export function installPendingUpdate(): void {
  desktopUpdater?.installOnQuit()
}

let desktopUpdater: ReturnType<typeof createDesktopUpdater> | null = null
let sendUpdateStatus: (status: UpdateStatusEvent) => void = () => undefined

/** 懒创建桌面更新器（状态经 sendUpdateStatus 推给主窗口） */
function updater(): ReturnType<typeof createDesktopUpdater> {
  desktopUpdater ??= createDesktopUpdater({
    fetch: (input, init) => globalThis.fetch(input, init),
    platform: process.platform,
    version: electronApp.getVersion(),
    dir: join(electronApp.getPath('userData'), 'updater'),
    now: () => Date.now(),
    emit: status => sendUpdateStatus(status),
    autoDownload: () => settingsStore().get('update.autoDownload'),
    launch: (file, args) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(file, args, { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      }),
    quit: () => electronApp.quit(),
  })
  return desktopUpdater
}

/** 实现 win / app / update 三个域，并把更新状态推给主窗口 */
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
      return updater().check()
    },
    download: () => updater().download(),
    install: () => updater().install(),
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
              releaseNotes: info.releaseNotes ?? latestInfo?.releaseNotes,
            }
          : info
    }
    const target = getMainWindow()
    if (target) emit(update, 'status', status, target.webContents)
  }
  sendUpdateStatus = sendStatus
}
