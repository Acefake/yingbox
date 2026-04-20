/**
 * 刮削服务
 * 封装电影刮削核心逻辑
 */
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem, ScrapeResult } from '@/types'
import { FileService } from '@/services/file-service'
import { NfoService } from '@/services/nfo-service'
import { TMDB_IMAGE_BASE_URL } from '@/constants/file'

// TMDB API 实例（需要从外部注入）
let tmdbApi: any = null

/**
 * 设置 TMDB API 实例
 */
export const setTmdbApi = (api: any): void => {
  tmdbApi = api
}

export class ScrapeService {
  /**
   * 搜索电影
   */
  static async searchMovie(query: string): Promise<Movie[]> {
    if (!tmdbApi) {
      throw new Error('TMDB API 未初始化')
    }

    try {
      const response = await tmdbApi.search.movies({ query })
      return response.results || []
    } catch (error) {
      console.error('搜索电影失败:', error)
      return []
    }
  }

  /**
   * 获取电影详情
   */
  static async getMovieDetails(movieId: number): Promise<any> {
    if (!tmdbApi) {
      throw new Error('TMDB API 未初始化')
    }

    try {
      return await tmdbApi.movies.details({
        movie_id: movieId,
        append_to_response: 'credits',
      })
    } catch (error) {
      console.error('获取电影详情失败:', error)
      return null
    }
  }

  /**
   * 清理电影名称（移除质量标识等）
   */
  static cleanMovieFileName(fileName: string): string {
    // 移除扩展名
    let name = fileName.replace(/\.[^/.]+$/, '')

    // 移除常见的质量标识
    const qualityTags = [
      /2160p/i,
      /1080p/i,
      /720p/i,
      /480p/i,
      /4k/i,
      /UHD/i,
      /HDR/i,
      /SDR/i,
      /BluRay/i,
      /BDRip/i,
      /DVDRip/i,
      /WEBRip/i,
      /WEB-DL/i,
      /HDTV/i,
      /CAM/i,
      /TS/i,
      /TC/i,
      /x264/i,
      /x265/i,
      /H264/i,
      /H265/i,
      /HEVC/i,
      /AVC/i,
      /AAC/i,
      /AC3/i,
      /DTS/i,
      /DD5\.1/i,
      /DD7\.1/i,
      /\[.*?\]/g,
      /\(.*?\)/g,
      /-[\w]+$/i, // 移除结尾的发布组标识
    ]

    qualityTags.forEach(tag => {
      name = name.replace(tag, ' ')
    })

    // 清理多余空格和特殊字符
    name = name.replace(/\s+/g, ' ').replace(/[._]/g, ' ').trim()

    return name
  }

  /**
   * 从文件名提取年份
   */
  static extractYear(fileName: string): string | null {
    const yearMatch = fileName.match(/\((\d{4})\)|\[(\d{4})\]|\.(\d{4})\./)
    return yearMatch ? yearMatch[1] || yearMatch[2] || yearMatch[3] : null
  }

  /**
   * 下载海报
   */
  static async downloadPoster(
    posterPath: string | null,
    savePath: string,
    movieName: string
  ): Promise<string | null> {
    if (!posterPath) return null

    const posterUrl = `${TMDB_IMAGE_BASE_URL}${posterPath}`
    const cleanName = FileService.cleanMovieName(movieName)
    const localPath = await window.api.path.join(
      savePath,
      `${cleanName}-poster.jpg`
    )

    const result = await FileService.downloadFile(posterUrl, localPath)
    return result.success ? localPath : null
  }

  /**
   * 下载背景图
   */
  static async downloadFanart(
    backdropPath: string | null,
    savePath: string,
    movieName: string
  ): Promise<string | null> {
    if (!backdropPath) return null

    const fanartUrl = `${TMDB_IMAGE_BASE_URL}${backdropPath}`
    const cleanName = FileService.cleanMovieName(movieName)
    const localPath = await window.api.path.join(
      savePath,
      `${cleanName}-fanart.jpg`
    )

    const result = await FileService.downloadFile(fanartUrl, localPath)
    return result.success ? localPath : null
  }

  /**
   * 执行完整刮削
   */
  static async scrapeMovie(
    item: ProcessedItem,
    movie: Movie
  ): Promise<ScrapeResult> {
    try {
      // 获取电影详情
      const details = await this.getMovieDetails(movie.id)

      if (!details) {
        return { success: false, error: '获取电影详情失败' }
      }

      // 确定目标文件夹
      let targetFolder: string
      const cleanName = FileService.cleanMovieName(movie.title)

      if (item.type === 'folder') {
        targetFolder = item.path
      } else {
        // 视频文件需要在同目录创建文件夹
        const parentDir = item.path.substring(0, item.path.lastIndexOf('/'))
        targetFolder = await window.api.path.join(parentDir, cleanName)

        // 创建文件夹
        const exists = await FileService.fileExists(targetFolder)
        if (!exists.data?.exists) {
          await FileService.createDirectory(targetFolder)
        }
      }

      // 写入 NFO 文件
      const nfoSuccess = await NfoService.writeNfoFile(
        targetFolder,
        movie.title,
        details
      )

      // 下载海报
      const posterPath = await this.downloadPoster(
        details.poster_path,
        targetFolder,
        movie.title
      )

      // 下载背景图
      const fanartPath = await this.downloadFanart(
        details.backdrop_path,
        targetFolder,
        movie.title
      )

      return {
        success: true,
        nfoPath: nfoSuccess
          ? await window.api.path.join(targetFolder, `${cleanName}.nfo`)
          : undefined,
        posterPath: posterPath || undefined,
        fanartPath: fanartPath || undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  /**
   * 清理旧的媒体文件
   */
  static async cleanOldMediaFiles(
    folderPath: string,
    movieName: string,
    keepFiles: string[] = []
  ): Promise<void> {
    const cleanName = FileService.cleanMovieName(movieName)
    const files = await FileService.readDirectory(folderPath)

    if (!files.success || !files.data) return

    const filesToDelete = (files.data as any[]).filter(file => {
      if (!file.isFile) return false

      const fileName = file.name.toLowerCase()
      const isMediaFile =
        fileName.endsWith('.jpg') ||
        fileName.endsWith('.jpeg') ||
        fileName.endsWith('.png') ||
        fileName.endsWith('.nfo')

      if (!isMediaFile) return false

      // 检查是否是需要保留的文件
      const isKeepFile = keepFiles.some(k =>
        fileName.includes(FileService.cleanMovieName(k).toLowerCase())
      )

      // 检查是否是新格式的文件
      const isNewFormat = fileName.includes(cleanName.toLowerCase())

      return !isKeepFile && !isNewFormat
    })

    // 删除旧文件
    for (const file of filesToDelete) {
      await FileService.deleteFile(file.path)
    }
  }
}
