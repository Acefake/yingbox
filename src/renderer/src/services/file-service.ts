/**
 * 文件操作服务
 * 封装所有文件系统相关操作
 */
import {
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  isVideoFile,
  isImageFile,
  isNfoFile,
} from '@/constants/media'
import {
  isHiddenFile,
  cleanMovieName,
  getFileExtension,
  getFileBaseName,
} from '@/constants/file'
import type { FileItem, ProcessedItem, FileResult } from '@/types'

export class FileService {
  /**
   * 判断是否为视频文件
   */
  static isVideoFile = isVideoFile

  /**
   * 判断是否为图片文件
   */
  static isImageFile = isImageFile

  /**
   * 判断是否为 NFO 文件
   */
  static isNfoFile = isNfoFile

  /**
   * 判断是否为隐藏文件
   */
  static isHiddenFile = isHiddenFile

  /**
   * 清理电影名称
   */
  static cleanMovieName = cleanMovieName

  /**
   * 获取文件扩展名
   */
  static getFileExtension = getFileExtension

  /**
   * 获取不带扩展名的文件名
   */
  static getFileBaseName = getFileBaseName

  /**
   * 读取目录
   */
  static async readDirectory(path: string): Promise<FileResult<FileItem[]>> {
    return await window.api.file.readdir(path)
  }

  /**
   * 递归读取目录
   */
  static async readDirectoryRecursive(
    path: string
  ): Promise<FileResult<FileItem[]>> {
    return await window.api.file.readdirRecursive(path)
  }

  /**
   * 读取文件
   */
  static async readFile(path: string): Promise<FileResult<string>> {
    return await window.api.file.read(path)
  }

  /**
   * 写入文件
   */
  static async writeFile(
    path: string,
    content: string
  ): Promise<FileResult<void>> {
    return await window.api.file.write(path, content)
  }

  /**
   * 删除文件
   */
  static async deleteFile(path: string): Promise<FileResult<void>> {
    return await window.api.file.delete(path)
  }

  /**
   * 检查文件是否存在
   */
  static async fileExists(
    path: string
  ): Promise<FileResult<{ exists: boolean }>> {
    return await window.api.file.exists(path)
  }

  /**
   * 创建目录
   */
  static async createDirectory(path: string): Promise<FileResult<void>> {
    return await window.api.file.mkdir(path)
  }

  /**
   * 移动文件/目录
   */
  static async move(
    source: string,
    destination: string
  ): Promise<FileResult<void>> {
    return await window.api.file.move(source, destination)
  }

  /**
   * 复制文件
   */
  static async copyFile(
    source: string,
    destination: string
  ): Promise<FileResult<void>> {
    return await window.api.file.copy(source, destination)
  }

  /**
   * 读取图片为 Data URL
   */
  static async readImageAsDataUrl(path: string): Promise<FileResult<string>> {
    return await window.api.file.readImage(path)
  }

  /**
   * 下载文件
   */
  static async downloadFile(
    url: string,
    savePath: string,
    timeout = 30000
  ): Promise<FileResult<void>> {
    return await window.api.http.download(url, savePath, timeout)
  }

  /**
   * 处理文件列表，按规则分组
   */
  static processFiles(files: FileItem[]): ProcessedItem[] {
    if (!files || files.length === 0) return []

    const result: ProcessedItem[] = []
    const processedPaths = new Set<string>()

    // 过滤掉隐藏文件
    const visibleFiles = files.filter(file => !isHiddenFile(file.name))

    // 找出所有顶级文件夹
    const allFolders = visibleFiles.filter(f => f.isDirectory)

    const topLevelFolders = allFolders.filter(folder => {
      return !allFolders.some(
        otherFolder =>
          otherFolder.path !== folder.path &&
          folder.path.startsWith(otherFolder.path + '/')
      )
    })

    // 处理顶级文件夹
    topLevelFolders.forEach(folder => {
      const folderFiles = visibleFiles.filter(
        f => f.isFile && f.path.startsWith(folder.path + '/')
      )

      const hasVideoFiles = folderFiles.some(file => isVideoFile(file.name))

      if (folderFiles.length > 0 && hasVideoFiles) {
        result.push({
          name: folder.name,
          path: folder.path,
          type: 'folder',
          fileCount: folderFiles.length,
          files: folderFiles,
        })

        folderFiles.forEach(file => {
          processedPaths.add(file.path)
        })
      }
    })

    // 处理独立的视频文件
    const independentVideoFiles = visibleFiles.filter(
      file =>
        file.isFile && isVideoFile(file.name) && !processedPaths.has(file.path)
    )

    independentVideoFiles.forEach(video => {
      const videoDir = video.path.substring(0, video.path.lastIndexOf('/'))

      const sameDirectoryFiles = visibleFiles.filter(
        file =>
          file.isFile &&
          file.path.startsWith(videoDir + '/') &&
          file.path.lastIndexOf('/') === videoDir.length
      )

      result.push({
        name: video.name,
        path: video.path,
        type: 'video',
        size: video.size,
        files: sameDirectoryFiles,
      })
    })

    return result
  }

  /**
   * 查找海报文件
   */
  static findPosterFile(
    files: FileItem[],
    baseName: string
  ): FileItem | undefined {
    const posterPatterns = [
      `${baseName}-poster.jpg`,
      `${baseName}-folder.jpg`,
      `${baseName}-movie.jpg`,
      'poster.jpg',
      'folder.jpg',
      'movie.jpg',
      'cover.jpg',
    ]

    return files.find(file => {
      const fileName = file.name.toLowerCase()
      return (
        IMAGE_EXTENSIONS.some(ext => fileName.endsWith(ext)) &&
        !fileName.includes('fanart') &&
        !fileName.includes('backdrop') &&
        posterPatterns.some(p => fileName === p.toLowerCase())
      )
    })
  }

  /**
   * 查找背景图文件
   */
  static findFanartFile(
    files: FileItem[],
    baseName: string
  ): FileItem | undefined {
    const fanartPatterns = [
      `${baseName}-fanart.jpg`,
      `${baseName}-backdrop.jpg`,
      'fanart.jpg',
      'backdrop.jpg',
    ]

    return files.find(file => {
      const fileName = file.name.toLowerCase()
      return (
        IMAGE_EXTENSIONS.some(ext => fileName.endsWith(ext)) &&
        fanartPatterns.some(p => fileName === p.toLowerCase())
      )
    })
  }

  /**
   * 查找 NFO 文件
   */
  static findNfoFile(files: FileItem[]): FileItem | undefined {
    return files.find(file => isNfoFile(file.name))
  }
}
