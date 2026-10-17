import { BrowserWindow, ipcMain } from 'electron'
import { mpvPlayer } from '../mpv-player'
import type { MpvOpenOptions, MpvStatus } from '../../shared/mpv'

/**
 * 注册所有 mpv:* IPC 处理器，并将播放器状态事件推送到渲染层。
 * 由 src/main/index.ts 调用一次。
 */
export function registerMpvIpc(): void {
  // ——— 控制指令 ———
  ipcMain.handle('mpv:open', async (_e, options: MpvOpenOptions) => {
    try {
      await mpvPlayer.open(options)
      return { success: true }
    } catch (error) {
      // 常见于系统未安装 mpv：以失败结果返回，而不是抛异常，
      // 避免渲染层收到未处理的 IPC 报错（渲染层据此回退到内置播放器）。
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('mpv:pause', async (_e, paused: boolean) => {
    await mpvPlayer.pause(paused)
    return { success: true }
  })

  ipcMain.handle('mpv:seek', async (_e, seconds: number, mode?: 'absolute' | 'relative') => {
    await mpvPlayer.seek(seconds, mode)
    return { success: true }
  })

  ipcMain.handle('mpv:volume', async (_e, vol: number) => {
    await mpvPlayer.setVolume(vol)
    return { success: true }
  })

  ipcMain.handle('mpv:mute', async (_e, muted: boolean) => {
    await mpvPlayer.setMute(muted)
    return { success: true }
  })

  ipcMain.handle('mpv:speed', async (_e, speed: number) => {
    await mpvPlayer.setSpeed(speed)
    return { success: true }
  })

  // RTX 视频超分开关（设置项）：影响 mpv 启动参数与运行时滤镜
  ipcMain.handle('mpv:setVsr', async (_e, enabled: boolean) => {
    await mpvPlayer.setVsrEnabled(Boolean(enabled))
    return { success: true }
  })

  // ——— 轨道控制 ———
  ipcMain.handle('mpv:setSubTrack', async (_e, id: number | false) => {
    await mpvPlayer.setSubTrack(id)
    return { success: true }
  })

  ipcMain.handle('mpv:setAudioTrack', async (_e, id: number) => {
    await mpvPlayer.setAudioTrack(id)
    return { success: true }
  })

  ipcMain.handle('mpv:addSubFile', async (_e, filePath: string) => {
    await mpvPlayer.addSubFile(filePath)
    return { success: true }
  })

  // ——— 播放列表 ———
  ipcMain.handle('mpv:playlistNext', async () => {
    await mpvPlayer.playlistNext()
    return { success: true }
  })

  ipcMain.handle('mpv:playlistPrev', async () => {
    await mpvPlayer.playlistPrev()
    return { success: true }
  })

  ipcMain.handle('mpv:playlistPlay', async (_e, index: number) => {
    await mpvPlayer.playlistPlay(index)
    return { success: true }
  })

  // ——— 状态查询 ———
  ipcMain.handle('mpv:getStatus', () => mpvPlayer.getStatus())

  ipcMain.handle('mpv:quit', () => {
    mpvPlayer.quit()
    return { success: true }
  })

  // ——— 状态推送：将 mpv 事件广播到所有渲染窗口 ———
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  mpvPlayer.on('status', (status: MpvStatus) => broadcast('mpv:status', status))
  mpvPlayer.on('end-file', (reason: string) => broadcast('mpv:end-file', reason))
  mpvPlayer.on('start-file', () => broadcast('mpv:start-file', null))
  mpvPlayer.on('exit', () => broadcast('mpv:exit', null))
  mpvPlayer.on('error', (msg: string) => broadcast('mpv:error', msg))
}
