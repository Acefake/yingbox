/**
 * 系统托盘 + 全局媒体键：托盘菜单显示内置播放器正在播放的标题，可播放 / 暂停、下一集、
 * 显示主窗口、退出；播放中注册 MediaPlayPause / MediaNextTrack / MediaPreviousTrack。
 *
 * 状态来自渲染层（nowPlaying.report），命令经 nowPlaying.command 推回主窗口的播放会话。
 * 两个开关：app.tray（托盘图标）、player.mediaKeys（媒体键），改了立即生效。
 */
import {
  Menu,
  type MenuItemConstructorOptions,
  Tray,
  type WebContents,
  app,
  globalShortcut,
  nativeImage,
  systemPreferences,
} from 'electron'
import trayIconIco from '../../../resources/logo.ico?asset'
import trayIconPng from '../../../build/icon.png?asset'
import { emit, implement } from '../rpc'
import { onSettingChanged, settingsStore } from '../settings'
import { nowPlaying } from '../../shared/contract/now-playing'
import type { MediaCommand, NowPlaying } from '../../shared/now-playing'
import {
  MEDIA_KEY_COMMANDS,
  type TrayAction,
  type TrayMenuEntry,
  shouldGrabMediaKeys,
  trayMenu,
  trayTooltip,
} from './rules'
import { watchReporter } from './reporter'

/** installTray 需要的窗口操作（窗口生命周期归 src/main/index.ts） */
export interface TrayHost {
  /** 显示并聚焦主窗口；已关闭时重新创建 */
  showMainWindow: () => void
}

/** 托盘图标：Windows 用多尺寸 ico，其他平台把 1024 的 png 缩到菜单栏尺寸 */
function trayImage(): Electron.NativeImage {
  if (process.platform === 'win32')
    return nativeImage.createFromPath(trayIconIco)
  const size = process.platform === 'darwin' ? 18 : 22
  return nativeImage
    .createFromPath(trayIconPng)
    .resize({ width: size, height: size, quality: 'best' })
}

/** macOS 上全局媒体键要「辅助功能」授权；只查不弹系统提示 */
function mediaKeysPermitted(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

/** 注册托盘、媒体键与 nowPlaying 域（app ready 后、创建窗口后调用一次） */
export function installTray(host: TrayHost): void {
  let tray: Tray | null = null
  let state: NowPlaying | null = null
  let reporter: WebContents | null = null
  let unwatchReporter: (() => void) | null = null
  let warnedPermission = false

  /** 命令发给正在报状态的那个窗口（播放器窗口，或跟着 mpv 的主窗口） */
  const send = (command: MediaCommand): void => {
    if (reporter && !reporter.isDestroyed())
      emit(nowPlaying, 'command', command, reporter)
  }

  const run = (action: TrayAction): void => {
    if (action === 'show') host.showMainWindow()
    else if (action === 'quit') app.quit()
    else send(action)
  }

  const toMenuItem = (entry: TrayMenuEntry): MenuItemConstructorOptions => {
    if (entry.type === 'separator') return { type: 'separator' }
    if (entry.type === 'label') return { label: entry.label, enabled: false }
    return {
      label: entry.label,
      enabled: entry.enabled,
      click: () => run(entry.action),
    }
  }

  const syncTray = (enabled: boolean): void => {
    if (!enabled) {
      tray?.destroy()
      tray = null
      return
    }
    if (!tray) {
      tray = new Tray(trayImage())
      // Windows / Linux 单击托盘图标直接回到主窗口；右键出菜单（macOS 单击即出菜单）
      if (process.platform !== 'darwin')
        tray.on('click', () => host.showMainWindow())
    }
    tray.setToolTip(trayTooltip(state))
    tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state).map(toMenuItem)))
  }

  const syncMediaKeys = (enabled: boolean): void => {
    const permitted = mediaKeysPermitted()
    if (enabled && state && !permitted && !warnedPermission) {
      warnedPermission = true
      console.warn('[tray] 未获得辅助功能授权，全局媒体键不可用')
    }
    const grab = shouldGrabMediaKeys({ enabled, state, permitted })
    for (const [accelerator, command] of MEDIA_KEY_COMMANDS) {
      const registered = globalShortcut.isRegistered(accelerator)
      if (grab && !registered) {
        if (!globalShortcut.register(accelerator, () => send(command)))
          console.warn(`[tray] 媒体键 ${accelerator} 已被其他程序占用`)
      } else if (!grab && registered) {
        globalShortcut.unregister(accelerator)
      }
    }
  }

  const refresh = (): void => {
    const values = settingsStore().snapshot().values
    syncTray(values['app.tray'])
    syncMediaKeys(values['player.mediaKeys'])
  }

  implement(nowPlaying, {
    report: ({ sender }, next) => {
      state = next
      if (reporter !== sender) {
        reporter = sender
        unwatchReporter?.()
        // 窗口关掉 / 渲染进程崩溃 / 页面重载：当作停止播放，清空托盘并释放媒体键
        unwatchReporter = watchReporter(sender, () => {
          if (reporter !== sender) return
          reporter = null
          unwatchReporter = null
          state = null
          refresh()
        })
      }
      refresh()
    },
  })

  onSettingChanged(change => {
    if (change.key === 'app.tray' || change.key === 'player.mediaKeys')
      refresh()
  })

  refresh()
}
