import { call, defineDomain, int, record, str } from './define'

/** 同目录找到的字幕文件 */
export interface SubtitleFile {
  name: string
  path: string
  ext: string
}

/** 字幕文本（统一为 WebVTT） */
export interface SubtitleText {
  success: boolean
  data?: string
  format?: string
  error?: string
  notConfigured?: boolean
}

/** OpenSubtitles 搜索条件 */
export interface SubtitleSearchOptions {
  query?: string
  imdbId?: string
  episode?: number
  season?: number
  languages?: string
}

/** OpenSubtitles 搜索结果条目 */
export interface SubtitleHit {
  name: string
  language: string
  downloads: number
  rating?: number
  size?: number
  format: string
  fileId: number
}

/** 字幕：本地外挂字幕与 OpenSubtitles 在线字幕。 */
export const subtitle = defineDomain('subtitle', {
  /** 查找本地视频同目录的字幕（只接受 local:// URL） */
  find: call<
    [localUrl: string],
    { success: boolean; data?: SubtitleFile[]; error?: string }
  >(a => [str(a[0], 'localUrl')]),
  /** 读取字幕并转为 WebVTT（自动识别编码与 srt/ass） */
  read: call<[filePath: string], SubtitleText>(a => [str(a[0], 'filePath')]),
  /** 在线搜索（需主进程环境变量 YINGBOX_OPENSUBTITLES_KEY） */
  searchOnline: call<
    [options: SubtitleSearchOptions],
    {
      success: boolean
      data?: SubtitleHit[]
      error?: string
      notConfigured?: boolean
    }
  >(a => [record<SubtitleSearchOptions>(a[0], 'options')]),
  /** 下载在线字幕并转为 WebVTT */
  downloadOnline: call<[fileId: number], SubtitleText>(a => [
    int(a[0], 'fileId'),
  ]),
})
