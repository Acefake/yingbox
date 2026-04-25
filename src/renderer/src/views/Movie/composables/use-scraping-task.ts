import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'
import { useScraping } from '@/views/movie/composables/use-scraping'
import { useGlobalQueue } from '@/composables/use-global-queue'

/**
 * 刮削任务处理hook
 */
export const useScrapingTask = () => {
  const { safeExecute } = useErrorHandler()
  const { scrapeMovieInFolder } = useScraping()
  const { addItem, setProcessing, setDone, setError, setStep } = useGlobalQueue()

  /**
   * 处理单个刮削任务
   */
  const processSingleScrapeTask = async (
    movie: Movie,
    currentScrapeItem: ProcessedItem
  ): Promise<string | null> => {
    console.log('=== 开始处理单个刮削任务 ===')
    console.log('电影数据:', movie)
    console.log('当前刮削项目:', currentScrapeItem)
    
    if (!currentScrapeItem) {
      console.error('没有选中的刮削项目')
      return null
    }

    const queueId = addItem(currentScrapeItem.name, 'movie')
    setProcessing(queueId)

    const taskResult = await safeExecute(
      async () => {
        console.log('开始处理电影文件')

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

          // 获取文件夹中的文件列表
          const folderFiles = await window.api.file.readdir(searchPath)
          if (!folderFiles.success || !folderFiles.data) {
            throw new Error(folderFiles.error || '读取目录失败')
          }
          const files = folderFiles.data as Array<{ name: string; isDirectory: boolean; isFile: boolean }>
          videoFile = files.find(file =>
            videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
          )
          if (!videoFile) {
            throw new Error('文件夹中未找到视频文件')
          }
          console.log('找到视频文件:', videoFile.name)
        } else {
          // 如果是视频文件类型，直接使用 currentScrapeItem.path 对应的文件
          const lastSlashIndex = Math.max(
            currentScrapeItem.path.lastIndexOf('/'),
            currentScrapeItem.path.lastIndexOf('\\')
          )
          searchPath = currentScrapeItem.path.substring(0, lastSlashIndex)
          isAlreadyScraped = false
          console.log('项目类型为视频文件，新刮削')

          // 直接从路径提取文件名，不扫描目录，避免选中错误的视频文件
          const videoFileName = currentScrapeItem.path.substring(lastSlashIndex + 1)
          videoFile = { name: videoFileName, isDirectory: false, isFile: true }
          console.log('使用当前选中的视频文件:', videoFile.name)
        }
        
        console.log('搜索路径:', searchPath)
        console.log('是否已刮削:', isAlreadyScraped)

        // 获取视频文件扩展名
        const videoExtension = videoFile.name.substring(
          videoFile.name.lastIndexOf('.')
        )
        console.log('视频文件扩展名:', videoExtension)

        // MetaTube 用 number 作为文件名，TMDB 用 title
        const isMetatube = !!(movie as any)._metatube
        const baseName = isMetatube ? (movie.original_title || movie.title) : movie.title
        console.log('使用文件名:', baseName, '| isMetatube:', isMetatube)

        // 构建新的文件名和文件夹名（文件夹包含年份，视频文件不包含年份）
        const year = movie.release_date ? movie.release_date.substring(0, 4) : ''
        const movieFolderName = year ? `${baseName} (${year})` : baseName
        const newVideoFileName = `${baseName}${videoExtension}`
        
        console.log('年份:', year)
        console.log('新视频文件名:', newVideoFileName)
        console.log('电影文件夹名:', movieFolderName)

        let movieFolderPath: string
        let currentVideoPath: string
        let newVideoPath: string

        if (isAlreadyScraped) {
          console.log('=== 处理已刮削的项目 ===')
          // 先在原文件夹中刮削（避免路径混乱）
          movieFolderPath = searchPath
          currentVideoPath = await window.api.path.join(movieFolderPath, videoFile.name)
          console.log('当前文件夹路径:', movieFolderPath)
          console.log('当前视频路径:', currentVideoPath)

          // 在原位置刮削
          await scrapeMovieInFolder(movie, movieFolderPath, baseName, (step: string, stepIndex: number) => {
            const steps = [
              { name: '获取详情', done: false },
              { name: '下载NFO', done: false },
              { name: '下载海报', done: false },
              { name: '下载背景图', done: false },
              { name: '下载演员照片', done: false },
            ]
            if (stepIndex >= 0 && stepIndex < steps.length) {
              for (let i = 0; i <= stepIndex; i++) {
                steps[i].done = true
              }
            }
            setStep(queueId, step, steps)
          })

          // 刮削完成后，检查是否需要重命名文件夹和视频文件
          const currentFolderName = await window.api.path.basename(searchPath)
          const expectedVideoFileName = `${movie.title}${videoExtension}`
          
          console.log('当前文件夹名:', currentFolderName)
          console.log('期望的视频文件名:', expectedVideoFileName)

          // 检查文件夹名是否需要更新
          if (currentFolderName !== movieFolderName) {
            console.log('需要重命名文件夹')
            const parentPath = await window.api.path.dirname(searchPath)
            const newFolderPath = await window.api.path.join(parentPath, movieFolderName)
            console.log('新文件夹路径:', newFolderPath)
            const renameFolderResult = await window.api.file.move(searchPath, newFolderPath)
            console.log('文件夹重命名结果:', renameFolderResult)
            if (!renameFolderResult.success) {
              throw new Error(`重命名文件夹失败: ${renameFolderResult.error}`)
            }
            movieFolderPath = newFolderPath
          }

          // 更新视频路径（文件夹可能已改名）
          currentVideoPath = await window.api.path.join(movieFolderPath, videoFile.name)
          
          // 检查视频文件是否需要重命名
          if (videoFile.name !== expectedVideoFileName) {
            console.log('需要重命名视频文件')
            newVideoPath = await window.api.path.join(movieFolderPath, expectedVideoFileName)
            console.log('新视频路径:', newVideoPath)
            const moveResult = await window.api.file.move(currentVideoPath, newVideoPath)
            console.log('视频文件重命名结果:', moveResult)
            if (!moveResult.success) {
              throw new Error(`重命名视频文件失败: ${moveResult.error}`)
            }
          }
        } else {
          console.log('=== 处理新刮削的项目 ===')
          currentVideoPath = await window.api.path.join(searchPath, videoFile.name)
          console.log('当前视频路径:', currentVideoPath)

          const progressCb = (step: string, stepIndex: number) => {
            const steps = [
              { name: '获取详情', done: false },
              { name: '下载NFO', done: false },
              { name: '下载海报', done: false },
              { name: '下载背景图', done: false },
              { name: '下载演员照片', done: false },
            ]
            if (stepIndex >= 0 && stepIndex < steps.length) {
              for (let i = 0; i <= stepIndex; i++) steps[i].done = true
            }
            setStep(queueId, step, steps)
          }

          // 防止循环嵌套：若searchPath本身已经是目标文件夹，直接原地刮削，不新建子文件夹
          const currentBaseName = await window.api.path.basename(searchPath)
          if (currentBaseName === movieFolderName) {
            console.log('searchPath 已是目标文件夹，原地刮削，不新建子文件夹')
            movieFolderPath = searchPath
            await scrapeMovieInFolder(movie, movieFolderPath, baseName, progressCb)
          } else {
            // 检查目标文件夹是否已存在
            movieFolderPath = await window.api.path.join(searchPath, movieFolderName)
            const folderExists = await window.api.file.exists(movieFolderPath)
            console.log('目标文件夹存在检查:', { path: movieFolderPath, exists: folderExists.exists })

            if (!folderExists.exists) {
              console.log('目标文件夹不存在，创建新文件夹')
              const createResult = await window.api.file.mkdir(movieFolderPath)
              console.log('文件夹创建结果:', createResult)
              if (!createResult.success) {
                throw new Error(`创建文件夹失败: ${createResult.error}`)
              }
            } else {
              console.log('目标文件夹已存在，直接使用')
            }

            // 先移动视频到目标文件夹，再在目标文件夹内刮削
            newVideoPath = await window.api.path.join(movieFolderPath, newVideoFileName)
            console.log('移动视频到目标文件夹:', newVideoPath)
            const moveResult = await window.api.file.move(currentVideoPath, newVideoPath)
            console.log('视频文件移动结果:', moveResult)
            if (!moveResult.success) {
              throw new Error(`移动视频文件失败: ${moveResult.error}`)
            }

            // 在目标文件夹内刮削（所有资源都写到目标文件夹）
            await scrapeMovieInFolder(movie, movieFolderPath, baseName, progressCb)
          }
        }

        console.log(isAlreadyScraped ? '电影信息已更新' : `文件已重命名为: ${newVideoFileName}`)

        return movieFolderPath
      },
      '处理电影文件失败'
    )

    if (taskResult) {
      setDone(queueId)
    } else {
      setError(queueId)
    }
    return taskResult || null
  }

  return {
    // 方法
    processSingleScrapeTask,
  }
}
