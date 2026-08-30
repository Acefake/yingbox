import { ref, computed, watch, shallowRef } from 'vue'
import type { ProcessedItem, MovieInfoType, ActorInfo } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'
import { parseNfo, type NfoData } from '@/services/nfo-service'
import { toLocalUrl } from '@/utils/local-url'

/** 模块级 NFO 缓存：path → NfoData */
const nfoCache = new Map<string, NfoData>()

/** 预加载缓存（仅用于 hover 预热） */
const preloadCache = new Set<string>()
const preloadImage = (url: string): void => {
  if (!url || preloadCache.has(url)) return
  preloadCache.add(url)
  const img = new Image()
  img.src = url
}

/** 刮削版本号：每次刮削完成后递增，使图片 URL 失效强制浏览器重新请求 */
let scrapeVersion = 0
export const bumpScrapeVersion = (): void => {
  scrapeVersion++
  nfoCache.clear()
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

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  /**
   * 计算海报图片路径
   */
  const posterImagePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) return null

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
    if (!selectedItem.value || !selectedItem.value.files) return null

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
              (fileName.includes('fanart') || fileName.includes('backdrop'))))
        )
      })
      return fanartFile ? fanartFile.path : null
    } else if (selectedItem.value.type === 'video') {
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
    if (!selectedItem.value || !selectedItem.value.files) return null

    if (selectedItem.value.type === 'folder') {
      const nfoFile = selectedItem.value.files.find((file: any) =>
        file.name.toLowerCase().endsWith('.nfo')
      )
      return nfoFile ? nfoFile.path : null
    } else if (selectedItem.value.type === 'video') {
      const nfoFile = selectedItem.value.files.find((file: any) =>
        file.name.toLowerCase().endsWith('.nfo')
      )
      return nfoFile ? nfoFile.path : null
    }
    return null
  })

  /** 使用 local:// URL 直接加载图片（零 IPC） */
  const loadPosterImage = (): void => {
    posterImageDataUrl.value = posterImagePath.value
      ? toLocalUrl(posterImagePath.value)
      : ''
  }

  const loadFanartImage = (): void => {
    fanartImageDataUrl.value = fanartImagePath.value
      ? toLocalUrl(fanartImagePath.value)
      : ''
  }

  /**
   * 预加载电影图片到浏览器缓存
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
   * 将 NfoData 转换为旧的 MovieInfoType 格式（向后兼容 UI 组件）
   */
  const nfoDataToMovieInfo = (data: NfoData): MovieInfoType => {
    return {
      title: data.title,
      originaltitle: data.originaltitle,
      year: data.year,
      plot: data.plot,
      genre: data.genres,
      director: data.directors?.join(', '),
      actor: data.actors?.map(a => a.name),
      actors: data.actors?.map(a => ({
        name: a.name,
        role: a.role,
      })),
      rating: data.rating,
      runtime: data.runtime,
      country: data.countries?.join(', '),
      studio: data.studios?.join(', '),
      premiered: data.premiered,
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
      movieInfo.value = nfoDataToMovieInfo(cached)
      return
    }

    await safeExecute(async () => {
      const result = await window.api.file.read(path)
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取NFO文件失败')
      }
      const content = result.data as string
      const parsed = parseNfo(content)
      nfoCache.set(path, parsed)
      nfoContent.value = content
      movieInfo.value = nfoDataToMovieInfo(parsed)
      return content
    }, '加载NFO文件失败')
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
    const basePath =
      item.type === 'folder'
        ? item.path
        : item.path.substring(0, item.path.lastIndexOf(sep))
    const actorsDir = basePath + sep + '.actors'

    const dirExists = await window.api.file
      .exists(actorsDir)
      .catch(() => ({ success: false, exists: false }))
    if (!dirExists.success || !dirExists.exists) return

    const results = await Promise.all(
      info.actors.map(async actor => {
        const safeActorName = actor.name.replace(/[<>:"/\\|?*]/g, '').trim()
        const photoPath = actorsDir + sep + safeActorName + '.jpg'
        const exists = await window.api.file
          .exists(photoPath)
          .catch(() => ({ success: false, exists: false }))
        return {
          name: actor.name,
          role: actor.role,
          photoDataUrl:
            exists.success && exists.exists ? toLocalUrl(photoPath) : undefined,
        }
      })
    )
    actors.value = results
  }

  // 图片路径变化时同步更新
  watch(posterImagePath, loadPosterImage, { immediate: true })
  watch(fanartImagePath, loadFanartImage, { immediate: true })

  // NFO 走 debounce
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => selectedItem.value,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => loadNfoContent(), 80)
    },
    { immediate: true }
  )

  // 演员照片延迟到空闲时间加载
  watch(movieInfo, () => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => loadActorPhotos())
    } else {
      setTimeout(() => loadActorPhotos(), 50)
    }
  })

  return {
    posterImageDataUrl,
    fanartImageDataUrl,
    nfoContent,
    movieInfo,
    actors,
    posterImagePath,
    fanartImagePath,
    nfoFilePath,
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
 */
export function warmNfoCache(items: any[]): void {
  const nfoPaths: string[] = []
  for (const item of items) {
    if (!item.files) continue
    const nfo = item.files.find((f: any) =>
      f.name.toLowerCase().endsWith('.nfo')
    )
    if (nfo && !nfoCache.has(nfo.path)) nfoPaths.push(nfo.path)
  }
  if (!nfoPaths.length) return

  let i = 0
  const next = (deadline?: IdleDeadline) => {
    while (i < nfoPaths.length && (!deadline || deadline.timeRemaining() > 2)) {
      const p = nfoPaths[i++]
      if (nfoCache.has(p)) continue
      window.api.file
        .read(p)
        .then(r => {
          if (r.success && r.data) {
            nfoCache.set(p, parseNfo(r.data as string))
          }
        })
        .catch(() => {})
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
