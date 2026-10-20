import { localUrlToFilePath } from '../local-media'
import { downloadSubtitle, searchSubtitles } from '../opensubtitles'
import { implement } from '../rpc'
import { findSubtitleFiles, readSubtitleAsVtt } from '../subtitle'
import { subtitle } from '../../shared/contract/subtitle'

/** 实现 subtitle 域 */
export function registerSubtitleIpc(): void {
  implement(subtitle, {
    // 只接受 local:// URL，避免渲染层借接口读取任意路径。
    find: async (_, localUrl) => {
      try {
        const filePath = localUrlToFilePath(localUrl)
        if (!filePath) return { success: false, error: 'invalid local url' }
        return { success: true, data: await findSubtitleFiles(filePath) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    read: async (_, filePath) => {
      try {
        if (!filePath) return { success: false, error: 'invalid path' }
        return await readSubtitleAsVtt(filePath)
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    // 在线字幕搜索（OpenSubtitles）
    searchOnline: async (_, options) => {
      try {
        return await searchSubtitles(options)
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    // 在线字幕下载：返回 WebVTT 文本，由渲染层以 blob URL 挂载
    downloadOnline: async (_, fileId) => {
      try {
        if (fileId <= 0) return { success: false, error: 'invalid file id' }
        return await downloadSubtitle(fileId)
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
  })
}
