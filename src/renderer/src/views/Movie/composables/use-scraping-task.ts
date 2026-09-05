import type { ProcessedItem } from '@/types'
import type { ScrapedMovie } from '@/types/scraping'
import { Modal } from 'ant-design-vue'
import { safeFileName } from '@/utils/file-name'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useGlobalQueue } from '@/composables/use-global-queue'

/**
 * 移动文件，目标已存在时弹窗让用户选择替换或重命名
 * @returns 移动后的最终路径，用户取消则返回 null
 */
const moveWithConflict = async (
  srcPath: string,
  destPath: string,
  fileName: string,
  signal: AbortSignal
): Promise<string | null> => {
  signal.throwIfAborted()
  const existsCheck = await window.api.file.exists(destPath)
  if (!existsCheck.success) throw new Error(existsCheck.error || '无法检查目标文件')
  signal.throwIfAborted()
  if (!existsCheck.exists) {
    const result = await window.api.file.move(srcPath, destPath)
    if (!result.success) throw new Error(result.error || '移动文件失败')
    return destPath
  }

  return new Promise<string | null>((resolve, reject) => {
    const finish = (value: string | null) => { signal.removeEventListener('abort', abort); resolve(value) }
    const fail = (error: unknown) => { signal.removeEventListener('abort', abort); reject(error) }
    const abort = () => { modal.destroy(); finish(null) }
    const modal = Modal.confirm({
      title: '文件已存在',
      content: `目标文件夹中已存在 "${fileName}"，如何处理？`,
      okText: '替换', cancelText: '重命名', keyboard: false, maskClosable: false,
      afterClose: () => finish(null),
      onOk: async () => {
        try {
          signal.throwIfAborted()
          const result = await window.api.file.move(srcPath, destPath, { replace: true })
          if (!result.success) throw new Error(result.error || '替换文件失败')
          finish(destPath)
        } catch (error) { fail(error) }
      },
      onCancel: async () => {
        try {
          const dotIndex = destPath.lastIndexOf('.')
          const base = dotIndex < 0 ? destPath : destPath.substring(0, dotIndex)
          const ext = dotIndex < 0 ? '' : destPath.substring(dotIndex)
          let counter = 2
          let newPath: string
          for (;;) {
            signal.throwIfAborted()
            newPath = `${base} (${counter++})${ext}`
            const check = await window.api.file.exists(newPath)
            if (!check.success) throw new Error(check.error || '无法检查重命名路径')
            if (!check.exists) break
          }
          signal.throwIfAborted()
          const result = await window.api.file.move(srcPath, newPath)
          if (!result.success) throw new Error(result.error || '重命名失败')
          finish(newPath)
        } catch (error) { fail(error) }
      },
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

// 任务完成回调队列
const _completions = new Map<string, { resolve: (v: string | null) => void }>()
const _results = new Map<string, string | null>()

/**
 * 从电影数据中提取统一的命名基准
 * JavBus 用 original_title (番号如 AAA-001)，TMDB 用 title
 */
function getBaseName(movie: ScrapedMovie): string {
  return safeFileName(movie._javbus ? movie.original_title || movie.title : movie.title || movie.original_title)
}

/**
 * 刮削任务处理hook
 */
export const useScrapingTask = () => {
  const { scrapeMovieInFolder } = useScraping()
  const { addItem, setDone, setError, setStep, setProcessing } =
    useGlobalQueue()

  const STEPS = [
    { name: '获取详情', done: false },
    { name: '下载NFO', done: false },
    { name: '下载海报', done: false },
    { name: '下载背景图', done: false },
    { name: '下载演员照片', done: false },
  ]

  const makeProgressCb = (queueId: string) => (step: string, stepIndex: number) => {
    const steps = STEPS.map((s, i) => ({
      ...s,
      done: i <= stepIndex,
    }))
    setStep(queueId, step, steps)
  }

  /**
   * 执行单个刮削任务的核心逻辑
   */
  const _doScrape = async (
    movie: ScrapedMovie,
    currentScrapeItem: ProcessedItem,
    queueId: string,
    signal: AbortSignal
  ): Promise<string | null> => {
    signal.throwIfAborted()
      const videoExtensions = [
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v',
      ]
      let videoFile: { name: string; isDirectory: boolean; isFile: boolean } | undefined
      let searchPath: string
      let isAlreadyScraped = false

      if (currentScrapeItem.type === 'folder') {
        searchPath = currentScrapeItem.path
        isAlreadyScraped = true

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
          file.isFile && videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
        )
        if (!videoFile) throw new Error('文件夹中未找到视频文件')
      } else {
        const lastSlashIndex = Math.max(
          currentScrapeItem.path.lastIndexOf('/'),
          currentScrapeItem.path.lastIndexOf('\\')
        )
        searchPath = currentScrapeItem.path.substring(0, lastSlashIndex)
        isAlreadyScraped = false

        const videoFileName = currentScrapeItem.path.substring(lastSlashIndex + 1)
        videoFile = { name: videoFileName, isDirectory: false, isFile: true }
      }

      const videoExtension = videoFile.name.substring(
        videoFile.name.lastIndexOf('.')
      )

      signal.throwIfAborted()
      // 统一命名基准
      const baseName = getBaseName(movie)
      const movieFolderName = baseName
      const newVideoFileName = `${baseName}${videoExtension}`

      let movieFolderPath: string
      let currentVideoPath: string

      if (isAlreadyScraped) {
        movieFolderPath = searchPath

        // 重命名文件夹（如果需要）
        const currentFolderName = await window.api.path.basename(searchPath)
        if (currentFolderName !== movieFolderName) {
          const parentPath = await window.api.path.dirname(searchPath)
          const newFolderPath = await window.api.path.join(
            parentPath,
            movieFolderName
          )
          const renameResult = await window.api.file.move(
            searchPath,
            newFolderPath
          )
          if (renameResult.success) {
            movieFolderPath = newFolderPath
          } else {
            console.warn('文件夹重命名失败，继续在原文件夹刮削:', renameResult.error)
          }
        }

        currentVideoPath = await window.api.path.join(
          movieFolderPath,
          videoFile.name
        )

        // 刮削
        await scrapeMovieInFolder(
          movie,
          movieFolderPath,
          baseName,
          (step, index) => { signal.throwIfAborted(); makeProgressCb(queueId)(step, index) }
        )

        // 重命名视频文件（如果需要）
        if (videoFile.name !== newVideoFileName) {
          const newVideoPath = await window.api.path.join(
            movieFolderPath,
            newVideoFileName
          )
          signal.throwIfAborted()
          const moved = await moveWithConflict(currentVideoPath, newVideoPath, newVideoFileName, signal)
          if (!moved) throw new Error('视频重命名失败或已取消')
        }
      } else {
        // 新刮削
        currentVideoPath = await window.api.path.join(
          searchPath,
          videoFile.name
        )

        const currentBaseName = await window.api.path.basename(searchPath)
        if (currentBaseName === movieFolderName) {
          // searchPath 已是目标文件夹，原地刮削
          movieFolderPath = searchPath
          await scrapeMovieInFolder(
            movie,
            movieFolderPath,
            baseName,
            (step, index) => { signal.throwIfAborted(); makeProgressCb(queueId)(step, index) }
          )
        } else {
          // 创建文件夹并移动视频
          movieFolderPath = await window.api.path.join(
            searchPath,
            movieFolderName
          )
          const folderExists = await window.api.file.exists(movieFolderPath)

          if (!folderExists.exists) {
            const createResult = await window.api.file.mkdir(movieFolderPath)
            if (!createResult.success) {
              throw new Error(`创建文件夹失败: ${createResult.error}`)
            }
          }

          const newVideoPath = await window.api.path.join(
            movieFolderPath,
            newVideoFileName
          )
          const finalVideoPath = await moveWithConflict(
            currentVideoPath,
            newVideoPath,
            newVideoFileName,
            signal
          )
          if (!finalVideoPath) {
            throw new Error('视频文件移动被取消或失败')
          }

          await scrapeMovieInFolder(
            movie,
            movieFolderPath,
            baseName,
            (step, index) => { signal.throwIfAborted(); makeProgressCb(queueId)(step, index) }
          )
        }
      }

      return movieFolderPath

  }

  /**
   * 统一刮削入口 —— 注册任务到队列，由调度器自动并发执行
   */
  const scrape = (
    movie: ScrapedMovie,
    currentScrapeItem: ProcessedItem,
    options?: { cancellable?: boolean; cancelFn?: () => void }
  ): Promise<string | null> => {
    const { id: queueId, isDuplicate } = addItem(
      currentScrapeItem.name,
      'movie',
      async (id: string, signal: AbortSignal) => {
        setProcessing(id)
        try {
          const result = await _doScrape(movie, currentScrapeItem, id, signal)
          signal.throwIfAborted()
          _results.set(id, result)
          setDone(id)
        } catch (e) {
          _results.set(id, null)
          setError(id)
          throw e
        } finally {
          _fireCompletion(id)
        }
      },
      { ...options, dedupKey: currentScrapeItem.path, cancelFn: () => {
        try { options?.cancelFn?.() } finally { _results.set(queueId, null); _fireCompletion(queueId) }
      } }
    )

    // 命中去重：等待已有任务完成，共享结果
    if (isDuplicate) {
      return new Promise<string | null>((resolve) => {
        const existing = _completions.get(queueId)
        if (existing) {
          const origResolve = existing.resolve
          existing.resolve = (v) => { origResolve(v); resolve(v) }
        } else {
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
  }
  _results.delete(id)
}
