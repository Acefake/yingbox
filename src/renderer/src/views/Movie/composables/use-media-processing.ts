import { ref, computed, watch, shallowRef } from 'vue'
import type { ProcessedItem, MovieInfoType, ActorInfo } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'

/** 模块级 NFO 缓存：path → content */
const nfoCache = new Map<string, string>()

/**
 * 将 Windows 本地路径转为 local:// URL（供 <img src> 直接使用，零 IPC）
 * e.g. "F:\\foo\\poster.jpg" → "local://f/foo/poster.jpg"
 */
function toLocalUrl(filePath: string): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/')
  // Windows 绝对路径 "F:/..." → host=drive letter, path=rest
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch) {
    return `local://${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
  }
  return `local:///${normalized}`
}

/** 刮削版本号：每次刮削完成后递增，使图片 URL 失效强制浏览器重新请求 */
let scrapeVersion = 0
export const bumpScrapeVersion = (): void => {
  scrapeVersion++
  nfoCache.clear()
}

/** 预加载缓存（仅用于 hover 预热，确保图片在浏览器缓存里） */
const preloadCache = new Set<string>()
const preloadImage = (url: string): void => {
  if (!url || preloadCache.has(url)) return
  preloadCache.add(url)
  const img = new Image()
  img.src = url
}

/**
 * 媒体处理hook
 */
export const useMediaProcessing = (selectedItem: any) => {
  const { safeExecute } = useErrorHandler()

  const posterImageDataUrl = ref('')
  const fanartImageDataUrl = ref('')
  const nfoContent = ref('')
  const movieInfo = shallowRef<MovieInfoType | null>(null)
  const actors = shallowRef<ActorInfo[]>([])

  // 图片扩展名
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  /**
   * 计算海报图片路径
   */
  const posterImagePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const folderName = selectedItem.value.name.toLowerCase()

      const posterFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          !fileName.includes('fanart') &&
          !fileName.includes('backdrop') &&
          (fileName.includes('poster') ||
            fileName.includes('cover') ||
            fileName.includes('folder') ||
            fileName.includes('thumb') ||
            fileName === 'poster.jpg' ||
            fileName === 'folder.jpg' ||
            fileName === 'movie.jpg' ||
            fileName === 'cover.jpg' ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              !fileName.includes('fanart') &&
              !fileName.includes('backdrop')))
        )
      })

      return posterFile ? posterFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的海报检测
      const videoBaseName = selectedItem.value.name
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()

      const posterFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName === `${videoBaseName}-poster.jpg` ||
            fileName === `${videoBaseName}-folder.jpg` ||
            fileName === `${videoBaseName}-movie.jpg` ||
            fileName === 'poster.jpg' ||
            fileName === 'folder.jpg' ||
            fileName === 'movie.jpg')
        )
      })

      return posterFile ? posterFile.path : null
    }

    return null
  })

  /**
   * 计算艺术图片路径
   */
  const fanartImagePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const folderName = selectedItem.value.name.toLowerCase()

      const fanartFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName.includes('fanart') ||
            fileName.includes('backdrop') ||
            fileName === 'fanart.jpg' ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              fileName.includes('fanart')) ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              fileName.includes('backdrop')))
        )
      })

      return fanartFile ? fanartFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的艺术图检测
      const videoBaseName = selectedItem.value.name
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()

      const fanartFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName === `${videoBaseName}-fanart.jpg` ||
            fileName === 'fanart.jpg')
        )
      })

      return fanartFile ? fanartFile.path : null
    }

    return null
  })

  /**
   * 计算NFO文件路径
   */
  const nfoFilePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const nfoFile = selectedItem.value.files.find((file: any) =>
        file.name.toLowerCase().endsWith('.nfo')
      )

      return nfoFile ? nfoFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的NFO检测 - 只要同目录下有NFO文件就认为有对应的NFO
      const nfoFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()
        return fileName.endsWith('.nfo')
      })

      return nfoFile ? nfoFile.path : null
    }

    return null
  })

  /** 通过 IPC 读取图片为 base64 data URL */
  const loadPosterImage = async (): Promise<void> => {
    if (!posterImagePath.value) {
      posterImageDataUrl.value = ''
      return
    }
    const result = await window.api.file.readImage(posterImagePath.value).catch(() => ({ success: false, data: null } as any))
    posterImageDataUrl.value = result.success && result.data ? (result.data as string) : ''
  }

  const loadFanartImage = async (): Promise<void> => {
    if (!fanartImagePath.value) {
      fanartImageDataUrl.value = ''
      return
    }
    const result = await window.api.file.readImage(fanartImagePath.value).catch(() => ({ success: false, data: null } as any))
    fanartImageDataUrl.value = result.success && result.data ? (result.data as string) : ''
  }

  /**
   * 预加载电影图片到浏览器缓存（hover 时触发，让 Image 提前请求 local://）
   */
  const preloadMovieImages = (item: ProcessedItem): void => {
    if (!item?.files) return
    for (const f of item.files) {
      const fn = f.name.toLowerCase()
      if (imageExtensions.some(ext => fn.endsWith(ext))) {
        preloadImage(toLocalUrl(f.path))
      }
    }
  }

  /**
   * 加载NFO文件内容（带缓存）
   */
  const loadNfoContent = async (): Promise<void> => {
    nfoContent.value = ''
    movieInfo.value = null
    if (!nfoFilePath.value) return

    const path = nfoFilePath.value
    if (nfoCache.has(path)) {
      const cached = nfoCache.get(path)!
      nfoContent.value = cached
      parseNfoContent(cached)
      return
    }

    await safeExecute(async () => {
      const result = await window.api.file.read(path)
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取NFO文件失败')
      }
      const content = result.data as string
      nfoCache.set(path, content)
      nfoContent.value = content
      parseNfoContent(content)
      return content
    }, '加载NFO文件失败')
  }

  /**
   * 解析NFO内容
   */
  const parseNfoContent = (content: string): void => {
    movieInfo.value = null
    if (!content) return

    try {
      const info: MovieInfoType = {}

      // 提取标题
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i)
      if (titleMatch) info.title = titleMatch[1].trim()

      // 提取原始标题
      const originalTitleMatch = content.match(
        /<originaltitle>([^<]+)<\/originaltitle>/i
      )
      if (originalTitleMatch) info.originaltitle = originalTitleMatch[1].trim()

      // 提取年份
      const yearMatch = content.match(/<year>(\d{4})<\/year>/i)
      if (yearMatch) info.year = yearMatch[1]

      // 提取剧情简介
      const plotMatch = content.match(/<plot>([^<]+)<\/plot>/i)
      if (plotMatch) info.plot = plotMatch[1].trim()

      // 提取类型（支持多个）
      const genreMatches = content.match(/<genre>([^<]+)<\/genre>/gi)
      if (genreMatches) {
        info.genre = genreMatches
          .map(m => m.replace(/<\/?genre>/gi, '').trim())
          .filter(Boolean)
      }

      // 提取导演（支持多个）
      const directorMatches = content.match(/<director>([^<]+)<\/director>/gi)
      if (directorMatches) {
        info.director = directorMatches
          .map(m => m.replace(/<\/?director>/gi, '').trim())
          .filter(Boolean)
          .join(', ')
      }

      // 提取演员完整块（名字 + 角色）
      const actorBlockRegex = /<actor>([\s\S]*?)<\/actor>/gi
      const parsedActors: ActorInfo[] = []
      let actorBlock: RegExpExecArray | null
      while ((actorBlock = actorBlockRegex.exec(content)) !== null) {
        const block = actorBlock[1]
        const nameM = block.match(/<name>([^<]+)<\/name>/i)
        const roleM = block.match(/<role>([^<]+)<\/role>/i)
        if (nameM) {
          parsedActors.push({
            name: nameM[1].trim(),
            role: roleM ? roleM[1].trim() : undefined,
          })
        }
      }
      info.actors = parsedActors
      info.actor = parsedActors.map(a => a.name)

      // 提取评分
      const ratingMatch = content.match(/<rating>([^<]+)<\/rating>/i)
      if (ratingMatch) info.rating = ratingMatch[1].trim()

      // 提取时长
      const runtimeMatch = content.match(/<runtime>([^<]+)<\/runtime>/i)
      if (runtimeMatch) info.runtime = runtimeMatch[1].trim()

      // 提取国家（支持多个）
      const countryMatches = content.match(/<country>([^<]+)<\/country>/gi)
      if (countryMatches) {
        info.country = countryMatches
          .map(m => m.replace(/<\/?country>/gi, '').trim())
          .filter(Boolean)
          .join(', ')
      }

      // 提取制片公司（支持多个）
      const studioMatches = content.match(/<studio>([^<]+)<\/studio>/gi)
      if (studioMatches) {
        info.studio = studioMatches
          .map(m => m.replace(/<\/?studio>/gi, '').trim())
          .filter(Boolean)
          .join(', ')
      }

      // 提取首映日期
      const premieredMatch = content.match(/<premiered>([^<]+)<\/premiered>/i)
      if (premieredMatch) info.premiered = premieredMatch[1].trim()

      movieInfo.value = info
    } catch (error) {
      console.error('解析NFO内容失败:', error)
    }
  }

  /**
   * 从 .actors 文件夹加载演员照片（并行）
   */
  const loadActorPhotos = async (): Promise<void> => {
    actors.value = []
    const info = movieInfo.value
    if (!info?.actors?.length) return

    const item = selectedItem.value
    if (!item) return

    const sep = item.path.includes('\\') ? '\\' : '/'
    const basePath = item.type === 'folder'
      ? item.path
      : item.path.substring(0, item.path.lastIndexOf(sep))
    const actorsDir = basePath + sep + '.actors'

    const dirExists = await window.api.file.exists(actorsDir).catch(() => ({ success: false, exists: false }))
    if (!dirExists.success || !dirExists.exists) return

    const results = await Promise.all(info.actors.map(async (actor) => {
      const safeActorName = actor.name.replace(/[<>:"/\\|?*]/g, '').trim()
      const photoPath = actorsDir + sep + safeActorName + '.jpg'
      const exists = await window.api.file.exists(photoPath).catch(() => ({ success: false, exists: false }))
      return { name: actor.name, role: actor.role, photoDataUrl: exists.success && exists.exists ? toLocalUrl(photoPath) : undefined }
    }))
    actors.value = results
  }

  // 图片路径变化时同步更新（无 IPC，无需 debounce）
  watch(posterImagePath, loadPosterImage, { immediate: true })
  watch(fanartImagePath, loadFanartImage, { immediate: true })
  // NFO 和演员照片走 debounce（仍需 IPC 读文件）
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => selectedItem.value,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => loadNfoContent(), 80)
    },
    { immediate: true }
  )
  watch(movieInfo, loadActorPhotos)

  return {
    // 状态
    posterImageDataUrl,
    fanartImageDataUrl,
    nfoContent,
    movieInfo,
    actors,

    // 计算属性
    posterImagePath,
    fanartImagePath,
    nfoFilePath,

    // 方法
    loadPosterImage,
    loadFanartImage,
    loadNfoContent,
    preloadMovieImages,
    loadActorPhotos,
    warmNfoCache,
  }
}

/**
 * 目录加载完成后，利用浏览器空闲时间批量预读所有 NFO 到 nfoCache
 * 这样切换时 loadNfoContent 直接命中缓存，零 IPC
 */
export function warmNfoCache(items: any[]): void {
  const nfoPaths: string[] = []
  for (const item of items) {
    if (!item.files) continue
    const nfo = item.files.find((f: any) => f.name.toLowerCase().endsWith('.nfo'))
    if (nfo && !nfoCache.has(nfo.path)) nfoPaths.push(nfo.path)
  }
  if (!nfoPaths.length) return

  let i = 0
  const next = (deadline?: IdleDeadline) => {
    while (i < nfoPaths.length && (!deadline || deadline.timeRemaining() > 2)) {
      const p = nfoPaths[i++]
      if (nfoCache.has(p)) continue
      window.api.file.read(p).then(r => {
        if (r.success && r.data) nfoCache.set(p, r.data as string)
      }).catch(() => {})
    }
    if (i < nfoPaths.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(next, { timeout: 2000 })
      } else {
        setTimeout(() => next(), 50)
      }
    }
  }

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(next, { timeout: 2000 })
  } else {
    setTimeout(() => next(), 200)
  }
}
