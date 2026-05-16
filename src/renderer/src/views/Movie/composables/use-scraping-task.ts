import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '@/types'
import { Modal } from 'ant-design-vue'
import { useErrorHandler } from '@/composables/use-error-handler'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useGlobalQueue } from '@/composables/use-global-queue'

/**
 * 移动文件，目标已存在时弹窗让用户选择替换或重命名
 * @returns 移动后的最终路径，用户取消则返回 null
 */
const moveWithConflict = async (
  srcPath: string,
  destPath: string,
  fileName: string
): Promise<string | null> => {
  const existsCheck = await window.api.file.exists(destPath)
  if (!existsCheck.exists) {
    const result = await window.api.file.move(srcPath, destPath)
    return result.success ? destPath : null
  }

  // 目标已存在，弹窗让用户选择
  return new Promise<string | null>((resolve) => {
    Modal.confirm({
      title: '文件已存在',
      content: `目标文件夹中已存在 "${fileName}"，如何处理？`,
      okText: '替换',
      cancelText: '重命名',
      onOk: async () => {
        // 替换：先删旧文件再移动
        await window.api.file.delete(destPath)
        const result = await window.api.file.move(srcPath, destPath)
        resolve(result.success ? destPath : null)
      },
      onCancel: async () => {
        // 重命名：尾缀加 (2)、(3)...
        const dotIndex = destPath.lastIndexOf('.')
        const base = destPath.substring(0, dotIndex)
        const ext = destPath.substring(dotIndex)
        let newPath = `${base} (2)${ext}`
        let counter = 3
        while (true) {
          const check = await window.api.file.exists(newPath)
          if (!check.exists) break
          newPath = `${base} (${counter})${ext}`
          counter++
        }
        const result = await window.api.file.move(srcPath, newPath)
        resolve(result.success ? newPath : null)
      },
    })
  })
}

// 任务完成回调队列
const _completions = new Map<string, { resolve: (v: string | null) => void }>()
const _results = new Map<string, string | null>()

/**
 * 刮削任务处理hook
 */
export const useScrapingTask = () => {
  const { safeExecute } = useErrorHandler()
  const { scrapeMovieInFolder } = useScraping()
  const { addItem, setDone, setError, setStep, setProcessing } =
    useGlobalQueue()

  /**
   * 执行单个刮削任务的核心逻辑
   */
  const _doScrape = async (
    movie: Movie,
    currentScrapeItem: ProcessedItem,
    queueId: string
  ): Promise<string | null> => {
    const taskResult = await safeExecute(async () => {
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
        const files = folderFiles.data as Array<{
          name: string
          isDirectory: boolean
          isFile: boolean
        }>
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
        const videoFileName = currentScrapeItem.path.substring(
          lastSlashIndex + 1
        )
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

      // 只使用番号（original_title）作为文件夹和文件名
      // 如果没有番号则使用 title，限制长度避免 Windows 路径过长
      const MAX_FOLDER_NAME_LENGTH = 80
      let baseName = movie.original_title || movie.title
      if (baseName.length > MAX_FOLDER_NAME_LENGTH) {
        baseName = baseName.substring(0, MAX_FOLDER_NAME_LENGTH).trimEnd()
        console.log('文件夹名过长，已截断:', baseName)
      }
      console.log('使用文件名:', baseName)

      // 构建新的文件名和文件夹名（只使用番号，不加年份）
      const movieFolderName = baseName
      const newVideoFileName = `${baseName}${videoExtension}`

      console.log('新视频文件名:', newVideoFileName)
      console.log('电影文件夹名:', movieFolderName)

      let movieFolderPath: string
      let currentVideoPath: string
      let newVideoPath: string

      if (isAlreadyScraped) {
        console.log('=== 处理已刮削的项目 ===')
        movieFolderPath = searchPath

        const currentFolderName = await window.api.path.basename(searchPath)
        if (currentFolderName !== movieFolderName) {
          const parentPath = await window.api.path.dirname(searchPath)
          const newFolderPath = await window.api.path.join(
            parentPath,
            movieFolderName
          )
          const renameFolderResult = await window.api.file.move(
            searchPath,
            newFolderPath
          )
          if (renameFolderResult.success) {
            movieFolderPath = newFolderPath
          } else {
            console.warn('电影文件夹重命名失败，继续在原文件夹刮削:', renameFolderResult.error)
          }
        }

        currentVideoPath = await window.api.path.join(
          movieFolderPath,
          videoFile.name
        )
        console.log('当前文件夹路径:', movieFolderPath)
        console.log('当前视频路径:', currentVideoPath)

        // 在原位置刮削
        await scrapeMovieInFolder(
          movie,
          movieFolderPath,
          baseName,
          (step: string, stepIndex: number) => {
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
          }
        )

        const expectedVideoFileName = `${movie.title}${videoExtension}`
        console.log('期望的视频文件名:', expectedVideoFileName)

        // 更新视频路径（文件夹可能已改名）
        currentVideoPath = await window.api.path.join(
          movieFolderPath,
          videoFile.name
        )

        // 检查视频文件是否需要重命名
        if (videoFile.name !== expectedVideoFileName) {
          console.log('需要重命名视频文件')
          newVideoPath = await window.api.path.join(
            movieFolderPath,
            expectedVideoFileName
          )
          console.log('新视频路径:', newVideoPath)
          const finalPath = await moveWithConflict(
            currentVideoPath,
            newVideoPath,
            expectedVideoFileName
          )
          if (!finalPath) {
            console.warn('视频文件移动被取消或失败')
          }
        }
      } else {
        console.log('=== 处理新刮削的项目 ===')
        currentVideoPath = await window.api.path.join(
          searchPath,
          videoFile.name
        )
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
          await scrapeMovieInFolder(
            movie,
            movieFolderPath,
            baseName,
            progressCb
          )
        } else {
          // 检查目标文件夹是否已存在
          movieFolderPath = await window.api.path.join(
            searchPath,
            movieFolderName
          )
          const folderExists = await window.api.file.exists(movieFolderPath)
          console.log('目标文件夹存在检查:', {
            path: movieFolderPath,
            exists: folderExists.exists,
          })

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
          newVideoPath = await window.api.path.join(
            movieFolderPath,
            newVideoFileName
          )
          console.log('移动视频到目标文件夹:', newVideoPath)
          const finalVideoPath = await moveWithConflict(
            currentVideoPath,
            newVideoPath,
            newVideoFileName
          )
          if (!finalVideoPath) {
            throw new Error('视频文件移动被取消或失败')
          }

          // 在目标文件夹内刮削（所有资源都写到目标文件夹）
          await scrapeMovieInFolder(
            movie,
            movieFolderPath,
            baseName,
            progressCb
          )
        }
      }

      console.log(
        isAlreadyScraped
          ? '电影信息已更新'
          : `文件已重命名为: ${newVideoFileName}`
      )

      return movieFolderPath
    }, '处理电影文件失败')

    return taskResult || null
  }

  /**
   * 统一刮削入口 —— 注册任务到队列，由调度器自动并发执行
   * 返回 Promise<string | null>，resolve 时任务已完成
   * 若同名任务已在队列中（去重），直接返回已有任务的结果
   */
  const scrape = (
    movie: Movie,
    currentScrapeItem: ProcessedItem,
    options?: { cancellable?: boolean; cancelFn?: () => void }
  ): Promise<string | null> => {
    const { id: queueId, isDuplicate } = addItem(
      currentScrapeItem.name,
      'movie',
      async (id: string) => {
        setProcessing(id)
        try {
          const result = await _doScrape(movie, currentScrapeItem, id)
          _results.set(id, result)
          setDone(id)
        } catch (e) {
          _results.set(id, null)
          setError(id)
          throw e // 让调度器的 catch 触发 _schedule()
        } finally {
          _fireCompletion(id)
        }
      },
      options
    )

    // 命中去重：等待已有任务完成，共享结果
    if (isDuplicate) {
      return new Promise<string | null>((resolve) => {
        const existing = _completions.get(queueId)
        if (existing) {
          // 已有任务完成后，用相同结果 resolve 新的 promise
          const origResolve = existing.resolve
          existing.resolve = (v) => { origResolve(v); resolve(v) }
        } else {
          // 任务已完成，直接返回结果
          resolve(_results.get(queueId) ?? null)
        }
      })
    }

    return new Promise<string | null>((resolve) => {
      _completions.set(queueId, { resolve })
    })
  }

  return {
    scrape,
    // 向后兼容别名
    processSingleScrapeTask: scrape,
    registerScrapeTask: scrape,
  }
}

/** 触发任务完成回调 */
function _fireCompletion(id: string): void {
  const cb = _completions.get(id)
  if (cb) {
    cb.resolve(_results.get(id) ?? null)
    _completions.delete(id)
    _results.delete(id)
  }
}
