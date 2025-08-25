import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '../types'
import { useErrorHandler } from './useErrorHandler'
import { useScraping } from './useScraping'

/**
 * 刮削任务处理hook
 */
export const useScrapingTask = () => {
  const { safeExecute } = useErrorHandler()
  const { scrapeMovieInFolder } = useScraping()

  /**
   * 处理单个刮削任务
   */
  const processSingleScrapeTask = async (
    movie: Movie, 
    currentScrapeItem: ProcessedItem
  ): Promise<void> => {
    if (!currentScrapeItem) {
      message.error('没有选中的刮削项目')
      return
    }

    await safeExecute(
      async () => {
        message.loading('正在处理电影文件...', 0)

        const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']
        let videoFile: any
        let searchPath: string
        let isAlreadyScraped = false

        // 根据 currentScrapeItem 确定搜索路径和处理方式
        if (currentScrapeItem.type === 'folder') {
          // 如果是文件夹类型，说明已经刮削过，在该文件夹中查找视频文件
          searchPath = currentScrapeItem.path
          isAlreadyScraped = true
        } else {
          // 如果是视频文件类型，在当前目录中查找
          searchPath = currentScrapeItem.path.substring(0, currentScrapeItem.path.lastIndexOf('/'))
          isAlreadyScraped = false
        }

        // 获取指定路径中的文件
        const folderFiles = await window.api.file.readdir(searchPath)
        
        if (!folderFiles.success || !folderFiles.data) {
          throw new Error(folderFiles.error || '读取目录失败')
        }

        const files = folderFiles.data as Array<{
          name: string
          isDirectory: boolean
          isFile: boolean
        }>

        videoFile = files.find(file =>
          videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
        )

        if (!videoFile) {
          throw new Error('未找到视频文件')
        }

        // 获取视频文件扩展名
        const videoExtension = videoFile.name.substring(videoFile.name.lastIndexOf('.'))

        // 清理电影名称，移除特殊字符以确保文件名安全
        const cleanMovieName = movie.title
          .replace(/[<>:"/\\|?*]/g, '') // 移除Windows不允许的字符
          .replace(/\s+/g, ' ') // 合并多个空格
          .trim()

        // 构建新的文件名和文件夹名
        const newVideoFileName = `${cleanMovieName}${videoExtension}`
        const movieFolderName = cleanMovieName

        let movieFolderPath: string
        let currentVideoPath: string
        let newVideoPath: string

        if (isAlreadyScraped) {
          // 如果已经刮削过，检查是否需要重命名文件夹和视频文件
          const currentFolderName = await window.api.path.basename(searchPath)
          const expectedVideoFileName = `${cleanMovieName}${videoExtension}`

          // 检查文件夹名是否需要更新
          if (currentFolderName !== movieFolderName) {
            // 需要重命名文件夹
            const parentPath = await window.api.path.dirname(searchPath)
            const newFolderPath = await window.api.path.join(parentPath, movieFolderName)

            const renameFolderResult = await window.api.file.move(searchPath, newFolderPath)
            
            if (!renameFolderResult.success) {
              throw new Error(`重命名文件夹失败: ${renameFolderResult.error}`)
            }

            movieFolderPath = newFolderPath
          } else {
            movieFolderPath = searchPath
          }

          currentVideoPath = await window.api.path.join(movieFolderPath, videoFile.name)

          // 检查视频文件是否需要重命名
          if (videoFile.name !== expectedVideoFileName) {
            // 需要重命名视频文件
            newVideoPath = await window.api.path.join(movieFolderPath, expectedVideoFileName)

            const moveResult = await window.api.file.move(currentVideoPath, newVideoPath)
            
            if (!moveResult.success) {
              throw new Error(`重命名视频文件失败: ${moveResult.error}`)
            }
          } else {
            // 文件名已经正确，无需移动
            newVideoPath = currentVideoPath
          }
        } else {
          // 如果是新刮削，按原有逻辑处理
          currentVideoPath = await window.api.path.join(searchPath, videoFile.name)
          movieFolderPath = await window.api.path.join(searchPath, movieFolderName)
          newVideoPath = await window.api.path.join(movieFolderPath, newVideoFileName)

          // 检查电影文件夹是否已存在，如果不存在则创建
          const folderExists = await window.api.file.exists(movieFolderPath)

          if (!folderExists.exists) {
            const createResult = await window.api.file.mkdir(movieFolderPath)
            
            if (!createResult.success) {
              throw new Error(`创建文件夹失败: ${createResult.error}`)
            }
          }

          // 重命名并移动视频文件到新文件夹
          const moveResult = await window.api.file.move(currentVideoPath, newVideoPath)
          
          if (!moveResult.success) {
            throw new Error(`移动视频文件失败: ${moveResult.error}`)
          }
        }

        message.destroy()
        
        if (isAlreadyScraped) {
          message.success('电影信息已更新')
        } else {
          message.success(`文件已重命名为: ${newVideoFileName}`)
        }

        // 现在调用现有的刮削逻辑来下载海报和NFO文件
        await scrapeMovieInFolder(movie, movieFolderPath, cleanMovieName)

        return true
      },
      '处理电影文件失败',
      '刮削任务完成'
    )
  }

  return {
    // 方法
    processSingleScrapeTask,
  }
}
