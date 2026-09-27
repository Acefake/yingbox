import { ipcMain } from 'electron'
import { localUrlToFilePath } from '../local-media'
import { findSubtitleFiles, readSubtitleAsVtt } from '../subtitle'

export function registerSubtitleIpc(): void {
  // 只接受 local:// URL，避免渲染层借接口读取任意路径。
  ipcMain.handle('subtitle:find', async (_, localUrl: string) => {
    try {
      const filePath = typeof localUrl === 'string' ? localUrlToFilePath(localUrl) : null
      if (!filePath) return { success: false, error: 'invalid local url' }
      const list = await findSubtitleFiles(filePath)
      return { success: true, data: list }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('subtitle:read', async (_, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'invalid path' }
      }
      return await readSubtitleAsVtt(filePath)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
