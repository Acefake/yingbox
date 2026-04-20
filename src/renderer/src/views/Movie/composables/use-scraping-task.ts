import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'
import { useScraping } from '@/views/movie/composables/use-scraping'

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
    console.log('=== 开始处理单个刮削任务 ===')
    console.log('电影数据:', movie)
    console.log('当前刮削项目:', currentScrapeItem)
    
    if (!currentScrapeItem) {
      console.error('没有选中的刮削项目')
      message.error('没有选中的刮削项目')
      return
    }

    await safeExecute(
      async () => {
        message.loading('正在处理电影文件...', 0)
        console.log('显示加载提示')

        const videoExtensions = [
          '.mp4',
          '.avi',
          '.mkv',
          '.mov',
          '.wmv',
          '.flv',
          '.webm',
          '.m4v',
        ]
        let videoFile: any
        let searchPath: string
        let isAlreadyScraped = false

        // 根据 currentScrapeItem 确定搜索路径和处理方式
        if (currentScrapeItem.type === 'folder') {
          // 如果是文件夹类型，说明已经刮削过，在该文件夹中查找视频文件
          searchPath = currentScrapeItem.path
          isAlreadyScraped = true
          console.log('项目类型为文件夹，已刮削过')
        } else {
          // 如果是视频文件类型，在当前目录中查找（支持 Windows 和 Unix 路径）
          const lastSlashIndex = Math.max(
            currentScrapeItem.path.lastIndexOf('/'),
            currentScrapeItem.path.lastIndexOf('\\')
          )
          searchPath = currentScrapeItem.path.substring(0, lastSlashIndex)
          isAlreadyScraped = false
          console.log('项目类型为视频文件，新刮削')
        }
        
        console.log('搜索路径:', searchPath)
        console.log('是否已刮削:', isAlreadyScraped)

        // 获取指定路径中的文件
        console.log('开始读取目录文件...')
        const folderFiles = await window.api.file.readdir(searchPath)
        console.log('目录读取结果:', folderFiles)

        if (!folderFiles.success || !folderFiles.data) {
          console.error('读取目录失败:', folderFiles.error)
          throw new Error(folderFiles.error || '读取目录失败')
        }

        const files = folderFiles.data as Array<{
          name: string
          isDirectory: boolean
          isFile: boolean
        }>

        console.log('目录中的文件:', files.map(f => f.name))

        // 如果是视频文件类型，检查该目录是否已经包含刮削资源（NFO 或海报）
        if (currentScrapeItem.type !== 'folder') {
          const hasNfo = files.some(f => f.name.toLowerCase().endsWith('.nfo'))
          const hasPoster = files.some(f =>
            f.name.toLowerCase().includes('poster') ||
            f.name.toLowerCase() === 'poster.jpg'
          )
          
          // 如果目录中已有 NFO 或海报，认为已经刮削过
          if (hasNfo || hasPoster) {
            isAlreadyScraped = true
            console.log('目录中已有刮削资源（NFO或海报），视为已刮削')
          }
        }

        videoFile = files.find(file =>
          videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
        )

        if (!videoFile) {
          console.error('未找到视频文件')
          throw new Error('未找到视频文件')
        }
        
        console.log('找到视频文件:', videoFile.name)

        // 获取视频文件扩展名
        const videoExtension = videoFile.name.substring(
          videoFile.name.lastIndexOf('.')
        )
        console.log('视频文件扩展名:', videoExtension)

        // 清理电影名称，移除特殊字符以确保文件名安全
        console.log('开始清理电影名称...')
        const cleanMovieName = movie.title
          .replace(/[<>:"/\\|?*]/g, '') // 移除Windows不允许的字符
          .replace(/\s+/g, ' ') // 合并多个空格
          .trim()
        console.log('清理后的电影名称:', cleanMovieName)

        // 构建新的文件名和文件夹名
        const newVideoFileName = `${cleanMovieName}${videoExtension}`
        const movieFolderName = cleanMovieName
        
        console.log('新视频文件名:', newVideoFileName)
        console.log('电影文件夹名:', movieFolderName)

        let movieFolderPath: string
        let currentVideoPath: string
        let newVideoPath: string

        if (isAlreadyScraped) {
          console.log('=== 处理已刮削的项目 ===')
          // 如果已经刮削过，检查是否需要重命名文件夹和视频文件
          const currentFolderName = await window.api.path.basename(searchPath)
          const expectedVideoFileName = `${cleanMovieName}${videoExtension}`
          
          console.log('当前文件夹名:', currentFolderName)
          console.log('期望的视频文件名:', expectedVideoFileName)

          // 检查文件夹名是否需要更新
          if (currentFolderName !== movieFolderName) {
            console.log('需要重命名文件夹')
            // 需要重命名文件夹
            const parentPath = await window.api.path.dirname(searchPath)
            const newFolderPath = await window.api.path.join(
              parentPath,
              movieFolderName
            )

            console.log('新文件夹路径:', newFolderPath)
            const renameFolderResult = await window.api.file.move(
              searchPath,
              newFolderPath
            )
            console.log('文件夹重命名结果:', renameFolderResult)

            if (!renameFolderResult.success) {
              throw new Error(`重命名文件夹失败: ${renameFolderResult.error}`)
            }

            movieFolderPath = newFolderPath
          } else {
            console.log('文件夹名无需更改')
            movieFolderPath = searchPath
          }

          currentVideoPath = await window.api.path.join(
            movieFolderPath,
            videoFile.name
          )
          console.log('当前视频路径:', currentVideoPath)

          // 检查视频文件是否需要重命名
          if (videoFile.name !== expectedVideoFileName) {
            console.log('需要重命名视频文件')
            // 需要重命名视频文件
            newVideoPath = await window.api.path.join(
              movieFolderPath,
              expectedVideoFileName
            )
            console.log('新视频路径:', newVideoPath)

            const moveResult = await window.api.file.move(
              currentVideoPath,
              newVideoPath
            )
            console.log('视频文件重命名结果:', moveResult)

            if (!moveResult.success) {
              throw new Error(`重命名视频文件失败: ${moveResult.error}`)
            }
          } else {
            console.log('视频文件名无需更改')
            // 文件名已经正确，无需移动
            newVideoPath = currentVideoPath
          }
        } else {
          console.log('=== 处理新刮削的项目 ===')
          // 如果是新刮削，按原有逻辑处理
          currentVideoPath = await window.api.path.join(
            searchPath,
            videoFile.name
          )
          movieFolderPath = await window.api.path.join(
            searchPath,
            movieFolderName
          )
          newVideoPath = await window.api.path.join(
            movieFolderPath,
            newVideoFileName
          )
          
          console.log('当前视频路径:', currentVideoPath)
          console.log('电影文件夹路径:', movieFolderPath)
          console.log('新视频路径:', newVideoPath)

          // 检查电影文件夹是否已存在，如果不存在则创建
          const folderExists = await window.api.file.exists(movieFolderPath)
          console.log('文件夹存在检查:', folderExists)

          if (!folderExists.exists) {
            console.log('文件夹不存在，创建文件夹')
            const createResult = await window.api.file.mkdir(movieFolderPath)
            console.log('文件夹创建结果:', createResult)

            if (!createResult.success) {
              throw new Error(`创建文件夹失败: ${createResult.error}`)
            }
          } else {
            console.log('文件夹已存在')
          }

          // 重命名并移动视频文件到新文件夹
          console.log('开始移动视频文件...')
          const moveResult = await window.api.file.move(
            currentVideoPath,
            newVideoPath
          )
          console.log('视频文件移动结果:', moveResult)

          if (!moveResult.success) {
            throw new Error(`移动视频文件失败: ${moveResult.error}`)
          }
        }

        message.destroy()
        console.log('隐藏加载提示')

        if (isAlreadyScraped) {
          message.success('电影信息已更新')
          console.log('电影信息已更新')
        } else {
          message.success(`文件已重命名为: ${newVideoFileName}`)
          console.log('文件已重命名:', newVideoFileName)
        }

        // 现在调用现有的刮削逻辑来下载海报和NFO文件
        console.log('=== 开始调用刮削逻辑 ===')
        console.log('电影文件夹路径:', movieFolderPath)
        console.log('清理后的电影名称:', cleanMovieName)
        await scrapeMovieInFolder(movie, movieFolderPath, cleanMovieName)
        console.log('刮削逻辑调用完成')

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
