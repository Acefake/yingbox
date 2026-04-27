import { getImageBaseUrl, getTmdb } from '@/api/tmdb'
import { searchMetatubeMovie, getMetatubeMovieDetail } from '@/api/metatube'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { backend } from '@/api/backend'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { ref } from 'vue'
import { ProcessedItem } from '@/types'

const getMetaLang = (): string =>
  (typeof window !== 'undefined' && localStorage.getItem('metadataLanguage')) ||
  'zh-CN'

/**
 * 带重试的下载函数
 * @param url 下载URL
 * @param path 保存路径
 * @param maxRetries 最大重试次数
 * @param retryDelay 重试延迟(ms)
 */
const downloadWithRetry = async (
  url: string,
  path: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<{ success: boolean; error?: string }> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await window.api.http.download(url, path)
      if (result.success) {
        return result
      }
      if (attempt === maxRetries) {
        console.warn(`下载失败（已重试 ${maxRetries} 次）: ${path}`)
        return result
      }
      const errorMsg = result.error?.toLowerCase() || ''
      // 权限错误不重试
      if (errorMsg.includes('eperm') || errorMsg.includes('permission')) {
        console.error(`下载失败（权限错误）: ${path}`)
        return result
      }
      // 网络错误重试
      if (
        errorMsg.includes('econnreset') ||
        errorMsg.includes('etimedout') ||
        errorMsg.includes('network')
      ) {
        console.warn(
          `下载失败（网络错误），${retryDelay}ms 后重试 (${attempt}/${maxRetries}): ${path}`
        )
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message.toLowerCase() : ''
      // 权限错误不重试
      if (errorMsg.includes('eperm') || errorMsg.includes('permission')) {
        console.error(`下载失败（权限错误）: ${path}`, e)
        return {
          success: false,
          error: e instanceof Error ? e.message : '未知错误',
        }
      }
      // 网络错误重试
      if (
        attempt < maxRetries &&
        (errorMsg.includes('econnreset') || errorMsg.includes('etimedout'))
      ) {
        console.warn(
          `下载异常，${retryDelay}ms 后重试 (${attempt}/${maxRetries}): ${path}`
        )
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }
      console.error(`下载失败: ${path}`, e)
      return {
        success: false,
        error: e instanceof Error ? e.message : '未知错误',
      }
    }
  }
  return { success: false, error: '下载失败' }
}

export const useScraping = () => {
  const currentScrapeItem = ref<ProcessedItem>()

  /**
   * 搜索电影
   * @param item 要刮削的项目（文件夹或视频文件）
   * @returns 搜索结果数组
   */
  const searchMovieInfo = async (item: ProcessedItem): Promise<Movie[]> => {
    try {
      // 设置当前刮削项目
      currentScrapeItem.value = item

      // 检查是否已有本地 NFO 文件
      if (item.hasNfo && item.files) {
        const nfoFile = item.files.find(file =>
          file.name.toLowerCase().endsWith('.nfo')
        )
        if (nfoFile) {
          const readResult = await window.api.file.read(nfoFile.path)

          if (readResult.success && readResult.data) {
            const nfoContent = readResult.data as string
            const nfoMovieInfo = parseNfoContent(nfoContent)

            // 将 NFO 信息转换为 Movie 格式
            const movieFromNfo: Movie = {
              id: nfoMovieInfo.id || 0,
              title: nfoMovieInfo.title || item.name,
              original_title: nfoMovieInfo.original_title || '',
              overview: nfoMovieInfo.overview || '',
              release_date: nfoMovieInfo.release_date || '',
              vote_average: nfoMovieInfo.vote_average || 0,
              vote_count: nfoMovieInfo.vote_count || 0,
              poster_path: nfoMovieInfo.poster_path || '',
              backdrop_path: nfoMovieInfo.backdrop_path || '',
              adult: false,
              genre_ids: [],
              original_language: '',
              popularity: 0,
              video: false,
            }

            console.log('从 NFO 生成的电影数据:', movieFromNfo)
            return [movieFromNfo]
          }
        }
      }

      let searchName = ''

      // 根据item类型提取搜索关键词
      if (item.type === 'folder') {
        searchName = item.name
      } else {
        searchName = item.name.replace(/\.[^.]*$/, '')
      }

      const provider = getScrapeProviderConfig().provider

      // JavBus Go 服务：直接用 fetchMeta，返回单个结果作为候选
      if (provider === 'javbus') {
        const avid = searchName
          .replace(/\.[^/.]+$/, '')
          .replace(/\s*\(\d{4}\)\s*$/, '')
          .trim()
          .toUpperCase()
        try {
          const meta = await backend.fetchMeta(avid)
          if (meta.error) return []
          return [
            {
              id: avid as any,
              title: meta.title || avid,
              original_title: meta.avid,
              overview: meta.description || '',
              release_date: meta.release_date || '',
              vote_average: 0,
              vote_count: 0,
              poster_path: meta.cover || '',
              backdrop_path: meta.fanarts?.[0] || '',
              adult: false,
              genre_ids: [],
              original_language: 'ja',
              popularity: 0,
              video: false,
              _javbus: meta,
            } as any,
          ]
        } catch (e) {
          console.error('JavBus 获取元数据失败:', e)
          return []
        }
      }

      // MetaTube 搜索路径：番号不需要 handleSearchParams 清理，直接用原始名称
      if (provider === 'metatube') {
        try {
          const results = await searchMetatubeMovie(searchName)
          console.log('MetaTube 搜索结果数量:', results.length)
          if (results.length === 0) return []
          return results.map(
            r =>
              ({
                id: r.id as any,
                title: r.title,
                original_title: r.number || r.title,
                overview: '',
                release_date: r.release_date || '',
                vote_average: r.score || 0,
                vote_count: 0,
                poster_path: r.thumb_url || '',
                backdrop_path: r.cover_url || '',
                adult: false,
                genre_ids: [],
                original_language: 'ja',
                popularity: 0,
                video: false,
                _metatube: { id: r.id, provider: r.provider },
              }) as any as Movie
          )
        } catch (e) {
          console.error('MetaTube 搜索失败:', e)
          return []
        }
      }

      // TMDB 搜索路径
      const cleanName = handleSearchParams(searchName)
      if (!cleanName) {
        console.error('清理后的名称为空')
        return []
      }
      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined
      const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

      // 显示加载提示
      try {
        let res = await getTmdb().search.movies({
          query: nameWithoutYear || cleanName,
          language: getMetaLang(),
          ...(year && { year }),
        })

        if (res.results.length === 0) {
          if (year) {
            res = await getTmdb().search.movies({
              query: nameWithoutYear,
              language: getMetaLang(),
            })
          }

          if (res.results.length === 0) {
            res = await getTmdb().search.movies({
              query: nameWithoutYear || cleanName,
              language: 'en-US',
              ...(year && { year }),
            })
          }
        }

        if (res.results.length === 0) {
          console.error('所有搜索策略均无结果')
          return []
        }
        const movies = res.results.map((movie: Movie) => ({
          ...movie,
          poster_path: movie.poster_path
            ? getImageBaseUrl('poster') + movie.poster_path
            : '',
          backdrop_path: movie.backdrop_path
            ? getImageBaseUrl('backdrop') + movie.backdrop_path
            : '',
          id: movie.id as number,
        })) as Movie[]
        console.log(
          '处理后的电影列表:',
          movies.map(m => ({
            title: m.title,
            id: m.id,
            hasBackdrop: !!m.backdrop_path,
          }))
        )
        return movies
      } catch (searchError) {
        console.error('搜索电影时出错:', searchError)
        return []
      }
    } catch (error) {
      console.error('自动刮削时出错:', error)
      return []
    }
  }

  /**
   * 清理文件夹中的旧电影相关文件（海报、艺术图、NFO文件）
   * @param folderPath 文件夹路径
   */
  const cleanOldMovieFiles = async (folderPath: string): Promise<void> => {
    try {
      const folderFiles = await window.api.file.readdir(folderPath)

      if (!folderFiles.success || !folderFiles.data) {
        console.error('读取文件夹失败')
        return
      }

      const files = folderFiles.data as Array<{
        name: string
        isDirectory: boolean
        isFile: boolean
      }>

      // 定义需要清理的文件类型
      const filesToDelete: string[] = []

      for (const file of files) {
        if (file.isFile) {
          const fileName = file.name.toLowerCase()

          // 检查是否是需要清理的文件类型
          const shouldDelete =
            // NFO 文件
            fileName.endsWith('.nfo') ||
            // 海报文件
            fileName.includes('poster') ||
            fileName.includes('movie') ||
            fileName.includes('folder') ||
            // 艺术图文件
            fileName.includes('fanart') ||
            fileName.includes('backdrop') ||
            // 常见的图片文件（但排除视频缩略图）
            ((fileName.endsWith('.jpg') ||
              fileName.endsWith('.jpeg') ||
              fileName.endsWith('.png') ||
              fileName.endsWith('.webp')) &&
              !fileName.includes('thumb'))

          if (shouldDelete) {
            const filePath = await window.api.path.join(folderPath, file.name)
            filesToDelete.push(filePath)
          }
        }
      }

      for (const filePath of filesToDelete) {
        try {
          const deleteResult = await window.api.file.delete(filePath)

          if (deleteResult.success) {
            console.log(
              `已删除旧文件: ${await window.api.path.basename(filePath)}`
            )
          } else {
            console.error(
              `删除文件失败: ${await window.api.path.basename(filePath)}`
            )
          }
        } catch (error) {
          console.error(`删除文件时出错: ${error}`)
        }
      }

      if (filesToDelete.length > 0) {
        console.log(`已清理 ${filesToDelete.length} 个旧文件`)
      }

      // 清理 .actors 文件夹（非关键操作，失败静默处理）
      const actorsDir = await window.api.path.join(folderPath, '.actors')
      const actorsDirExists = await window.api.file.exists(actorsDir)
      if (actorsDirExists.exists) {
        try {
          // 先删除文件夹内的所有文件
          const actorsFiles = await window.api.file.readdir(actorsDir)
          if (actorsFiles.success && actorsFiles.data) {
            const files = actorsFiles.data as Array<{
              name: string
              isFile: boolean
            }>
            for (const file of files) {
              if (file.isFile) {
                const filePath = await window.api.path.join(
                  actorsDir,
                  file.name
                )
                const deleteResult = await window.api.file.delete(filePath)
                if (!deleteResult.success) {
                  // 静默失败，不影响主流程
                }
              }
            }
          }
          // 然后删除空文件夹
          await window.api.file.delete(actorsDir)
        } catch (e) {
          // 静默失败，不影响刮削流程
        }
      }
    } catch (error) {
      console.error('清理旧文件时出错:', error)
      console.warn('清理旧文件时出错:', error)
    }
  }

  /**
   * 清理电影名称，移除不必要的字符和信息
   * @param movieName 原始电影名称
   * @returns 清理后的电影名称
   */
  const handleSearchParams = (movieName: string): string => {
    let cleanName = movieName
      // 移除文件扩展名
      .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rmvb)$/i, '')
      // 把点和下划线替换为空格（场景发布组常用）
      .replace(/[._]/g, ' ')
      // 移除括号内容 [] () 【】（）
      .replace(/\s*[\[\(【（].*?[\]\)】）]\s*/g, ' ')
      // 移除分辨率
      .replace(/\b(1080[pi]|720p|480p|2160p|4K|UHD|576p)\b/gi, '')
      // 移除 HDR 标记
      .replace(
        /\b(HDR\d*|DV|Dolby[\s.]?Vision|HLG|SDR|10bit|12bit|8bit)\b/gi,
        ''
      )
      // 移除流媒体平台标记
      .replace(
        /\b(MAX|NF|AMZN|DSNP|HULU|iTUNES|ATVP|PCOK|STAN|CRAV|BCORE|iP)\b/gi,
        ''
      )
      // 移除来源标记
      .replace(
        /\b(BluRay|Blu-?Ray|BDRip|BDRemux|REMUX|WEB-?DL|WEBRip|WEB|HDTV|DVDRip|DVD|HDDVD)\b/gi,
        ''
      )
      // 移除编码标记
      .replace(/\b(x264|x265|H[\s.]?264|H[\s.]?265|HEVC|AVC|VP9|AV1)\b/gi, '')
      // 移除音频标记
      .replace(
        /\b(AAC|DTS[\s-]?HD|DTS|TrueHD|Atmos|FLAC|AC3|EAC3|DDP?[\s.]?\d[\s.]?\d|MA[\s.]?\d[\s.]?\d)\b/gi,
        ''
      )
      // 移除发布组 -GROUP 和 @GROUP
      .replace(/-[A-Za-z0-9]+$/i, '')
      .replace(/@[A-Za-z0-9]+$/i, '')
      // 移除其它常见标记
      .replace(
        /\b(PROPER|REPACK|COMPLETE|DUBBED|SUBBED|MULTI|EXTENDED|UNCUT|REMASTERED|DIRECTORS[\s.]?CUT|LIMITED|INTERNAL)\b/gi,
        ''
      )
      // 移除孤立数字（如 DDP5.1 点换空格后残留的 "1"、"5" 等）
      .replace(/(?<!\w)\d{1,2}(?!\w)/g, '')
      // 清理多余空格和尾部连字符
      .replace(/[-\s]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()

    return cleanName
  }

  /**
   * 在指定文件夹中刮削电影信息（下载海报和创建NFO文件）
   * @param movieData 电影数据
   * @param folderPath 文件夹路径
   * @param videoBaseName 视频文件基础名称（不含扩展名）
   * @param progressCallback 进度回调 (step: string, stepIndex: number) => void
   */
  const scrapeMovieInFolder = async (
    movieData: Movie,
    folderPath: string,
    videoBaseName: string,
    progressCallback?: (step: string, stepIndex: number) => void
  ): Promise<void> => {
    try {
      const existingResources = await checkExistingResources(
        folderPath,
        videoBaseName
      )

      if (existingResources.hasNfo && existingResources.nfoContent) {
        const nfoMovieInfo = parseNfoContent(existingResources.nfoContent)

        // 合并 NFO 中的信息到 movieData
        if (nfoMovieInfo.title && !movieData.title) {
          movieData.title = nfoMovieInfo.title
        }
        if (nfoMovieInfo.original_title && !movieData.original_title) {
          movieData.original_title = nfoMovieInfo.original_title
        }
        if (nfoMovieInfo.overview && !movieData.overview) {
          movieData.overview = nfoMovieInfo.overview
        }
        if (nfoMovieInfo.release_date && !movieData.release_date) {
          movieData.release_date = nfoMovieInfo.release_date
        }
        if (nfoMovieInfo.vote_average && !movieData.vote_average) {
          movieData.vote_average = nfoMovieInfo.vote_average
        }
        if (nfoMovieInfo.vote_count && !movieData.vote_count) {
          movieData.vote_count = nfoMovieInfo.vote_count
        }
        if (nfoMovieInfo.poster_path && !movieData.poster_path) {
          movieData.poster_path = nfoMovieInfo.poster_path
        }
        if (nfoMovieInfo.backdrop_path && !movieData.backdrop_path) {
          movieData.backdrop_path = nfoMovieInfo.backdrop_path
        }
      }

      console.log('开始清理旧文件并下载电影信息')
      await cleanOldMovieFiles(folderPath)

      // 构建文件路径
      const nfoFileName = `${videoBaseName}.nfo`

      // 直接使用接口返回的名称，不做清理
      const posterFileNames = [
        `${videoBaseName}-poster.jpg`,
        `${videoBaseName}-movie.jpg`,
        `${videoBaseName}-folder.jpg`,
      ]

      const fanartFileNames = [`${videoBaseName}-fanart.jpg`]

      const nfoPath = await window.api.path.join(folderPath, nfoFileName)

      const posterPaths: { fileName: string; path: string }[] = []

      for (const fileName of posterFileNames) {
        const path = await window.api.path.join(folderPath, fileName)
        posterPaths.push({ fileName, path })
      }

      const fanartPaths: { fileName: string; path: string }[] = []

      for (const fileName of fanartFileNames) {
        const path = await window.api.path.join(folderPath, fileName)
        fanartPaths.push({ fileName, path })
      }

      // JavBus: 直接使用 _javbus 元数据写入 NFO + 下载图片
      const javbusMeta = (movieData as any)._javbus
      if (javbusMeta) {
        progressCallback?.('正在写入 NFO 文件...', 1)
        const releaseYear = javbusMeta.release_date
          ? new Date(javbusMeta.release_date).getFullYear()
          : ''
        const keywords = (javbusMeta.keywords || [])
          .map((k: string) => `  <genre>${k}</genre>`)
          .join('\n')
        const actressXml = Object.keys(javbusMeta.actress || {})
          .map(
            (name: string) => `  <actor>\n    <name>${name}</name>\n  </actor>`
          )
          .join('\n')
        const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${javbusMeta.title || movieData.title || ''}</title>
  <originaltitle>${javbusMeta.avid || ''}</originaltitle>
  <year>${releaseYear}</year>
  <plot>${javbusMeta.description || ''}</plot>
  <outline>${javbusMeta.description || ''}</outline>
  <runtime>${javbusMeta.duration || ''}</runtime>
${keywords}
  <premiered>${javbusMeta.release_date || ''}</premiered>
${actressXml}
</movie>`
        await window.api.file.write(nfoPath, nfoContent)

        if (javbusMeta.cover) {
          progressCallback?.('正在下载封面...', 2)
          const coverUrl = backend.proxyUrl(javbusMeta.cover)
          for (const { path } of posterPaths) {
            await downloadWithRetry(coverUrl, path)
          }
        }

        if (javbusMeta.fanarts?.length) {
          progressCallback?.('正在下载预览图...', 3)
          for (let i = 0; i < javbusMeta.fanarts.length; i++) {
            const fanartUrl = backend.proxyUrl(javbusMeta.fanarts[i])
            const fanartName =
              i === 0
                ? `${videoBaseName}-fanart.jpg`
                : `${videoBaseName}-fanart-${i}.jpg`
            const fanartPath = await window.api.path.join(
              folderPath,
              fanartName
            )
            await downloadWithRetry(fanartUrl, fanartPath)
          }
        }

        if (Object.keys(javbusMeta.actress || {}).length) {
          progressCallback?.('正在下载演员照片...', 4)
          const actorsDir = await window.api.path.join(folderPath, '.actors')
          await window.api.file.mkdir(actorsDir)
          for (const [name, imgUrl] of Object.entries(
            javbusMeta.actress as Record<string, string>
          )) {
            if (imgUrl) {
              const safeActorName = name.replace(/[<>:"/\\|?*]/g, '').trim()
              const photoPath = await window.api.path.join(
                actorsDir,
                `${safeActorName}.jpg`
              )
              await downloadWithRetry(backend.proxyUrl(imgUrl), photoPath)
            }
          }
        }

        console.log('JavBus 刮削完成')
        return
      }

      // MetaTube: 获取完整详情（包含演员/导演等）
      const metaInfo = (movieData as any)._metatube as
        | { id: string; provider: string }
        | undefined
      console.log(
        '[scrapeMovieInFolder] _metatube:',
        metaInfo,
        '| movie.id:',
        movieData.id,
        '| title:',
        movieData.title
      )
      if (metaInfo) {
        progressCallback?.('正在获取 MetaTube 电影详情...', 0)
        try {
          const detail = await getMetatubeMovieDetail(
            metaInfo.provider,
            metaInfo.id
          )
          if (detail) {
            if (detail.thumb_url && !movieData.poster_path)
              movieData.poster_path = detail.thumb_url
            if (detail.cover_url && !movieData.backdrop_path)
              movieData.backdrop_path = detail.cover_url
            ;(movieData as any).genres = (detail.genres || []).map(
              (g: string) => ({ id: 0, name: g })
            )
            ;(movieData as any).runtime = detail.runtime || 0
            ;(movieData as any).production_companies = detail.studio
              ? [{ name: detail.studio }]
              : []
            ;(movieData as any).directors = detail.director
              ? [{ name: detail.director, profile_path: '' }]
              : []
            ;(movieData as any).cast = (detail.actors || []).map((a: any) => ({
              name: typeof a === 'string' ? a : a.name || String(a),
              profile_path: typeof a === 'string' ? '' : a.thumb_url || '',
            }))
            if (!movieData.overview && detail.summary)
              movieData.overview = detail.summary
            console.log('MetaTube 详情获取成功')
          }
        } catch (e) {
          console.warn('MetaTube 详情获取失败:', e)
        }
        // MetaTube 演员照片下载（如有）
        const cast = (movieData as any).cast || []
        if (cast.length > 0) {
          progressCallback?.('正在下载演员照片...', 4)
          const actorsDir = await window.api.path.join(folderPath, '.actors')
          await window.api.file.mkdir(actorsDir)
          for (const actor of cast) {
            if (actor.profile_path) {
              const safeActorName = actor.name
                .replace(/[<>:"/\\|?*]/g, '')
                .trim()
              const photoPath = await window.api.path.join(
                actorsDir,
                `${safeActorName}.jpg`
              )
              await downloadWithRetry(actor.profile_path, photoPath)
            }
          }
        }
      } else {
        // TMDB: 获取完整电影详情（类型名称/时长/制片国家/制片公司/背景图）
        if (movieData.id) {
          progressCallback?.('正在获取电影详情...', 0)
          try {
            const details = (await getTmdb().movies.details(
              movieData.id as number
            )) as any
            if (details.backdrop_path && !movieData.backdrop_path) {
              movieData.backdrop_path = `${getImageBaseUrl('backdrop')}${details.backdrop_path}`
            }
            ;(movieData as any).genres = details.genres || []
            ;(movieData as any).runtime = details.runtime || 0
            ;(movieData as any).production_countries =
              details.production_countries || []
            ;(movieData as any).production_companies =
              details.production_companies || []
            console.log('获取电影详情成功', {
              genres: details.genres,
              runtime: details.runtime,
            })
          } catch (e) {
            console.warn('获取电影详情失败:', e)
          }
        }

        const { directors, cast } = await getMovieCredits(movieData.id)
        console.log('演职员信息:', { directors, cast })
        ;(movieData as any).directors = directors
        ;(movieData as any).cast = cast

        // 下载演员照片到 .actors 文件夹
        if (cast.length > 0) {
          progressCallback?.('正在下载演员照片...', 4)
          const actorsDir = await window.api.path.join(folderPath, '.actors')
          await window.api.file.mkdir(actorsDir)
          for (const actor of cast) {
            if (actor.profile_path) {
              const photoUrl = actor.profile_path.startsWith('http')
                ? actor.profile_path
                : `${getImageBaseUrl('actor')}${actor.profile_path}`
              const safeActorName = actor.name
                .replace(/[<>:"/\\|?*]/g, '')
                .trim()
              const photoPath = await window.api.path.join(
                actorsDir,
                `${safeActorName}.jpg`
              )
              const result = await downloadWithRetry(photoUrl, photoPath)
              if (result.success) {
                console.log(`演员照片下载成功: ${actor.name}`)
              } else {
                console.warn(`演员照片下载失败: ${actor.name}`)
              }
            }
          }
        }
      }

      // 共用：写入 NFO、下载海报和背景图
      const nfoContent = createNfoContent(movieData)
      progressCallback?.('正在写入NFO文件...', 1)
      const nfoResult = await window.api.file.write(nfoPath, nfoContent)
      console.log('NFO写入结果:', nfoResult)

      if (!nfoResult.success) {
        throw new Error(`创建NFO文件失败: ${nfoResult.error}`)
      }

      if (movieData.poster_path) {
        const posterUrl = movieData.poster_path.startsWith('http')
          ? movieData.poster_path
          : `${getImageBaseUrl('poster')}${movieData.poster_path}`

        progressCallback?.('正在下载海报...', 2)
        for (const { fileName, path } of posterPaths) {
          const posterResult = await downloadWithRetry(posterUrl, path)
          console.log(`海报 ${fileName} 下载结果:`, posterResult)

          if (!posterResult.success) {
            console.error(`下载 ${fileName} 失败: ${posterResult.error}`)
          }
        }
      }

      if (movieData.backdrop_path) {
        const fanartUrl = movieData.backdrop_path.startsWith('http')
          ? movieData.backdrop_path
          : `${getImageBaseUrl('backdrop')}${movieData.backdrop_path}`

        progressCallback?.('正在下载背景图...', 3)
        for (const { fileName, path } of fanartPaths) {
          const fanartResult = await downloadWithRetry(fanartUrl, path)
          console.log(`背景图 ${fileName} 下载结果:`, fanartResult)

          if (!fanartResult.success) {
            console.error(`下载 ${fileName} 失败: ${fanartResult.error}`)
          }
        }
      }

      console.log('电影信息刮削完成')
    } catch (error) {
      console.error('刮削电影信息失败:', error)
    }
  }

  /**
   * 获取电影演职员信息
   * @param movieId 电影 ID
   * @returns 包含导演和演员信息的对象
   */
  const getMovieCredits = async (
    movieId: number
  ): Promise<{ directors: any[]; cast: any[] }> => {
    try {
      const credits = await getTmdb().movies.credits(movieId)
      console.log('演职员信息:', credits)

      // 提取导演信息
      const directors = credits.crew
        .filter((person: any) => person.job === 'Director')
        .map((director: any) => ({
          id: director.id,
          name: director.name,
          profile_path: director.profile_path,
          tmdbid: director.id,
        }))

      // 提取演员信息（前 10 位）
      const cast = credits.cast.slice(0, 10).map((actor: any) => ({
        id: actor.id,
        name: actor.name,
        character: actor.character,
        profile_path: actor.profile_path,
        tmdbid: actor.id,
        order: actor.order,
      }))

      return { directors, cast }
    } catch (error) {
      console.error('获取演职员信息失败:', error)
      return { directors: [], cast: [] }
    }
  }

  /**
   * 创建NFO文件内容
   * @param movieData 电影数据
   * @returns NFO XML内容
   */
  const createNfoContent = (movieData: Movie): string => {
    const releaseYear = movieData.release_date
      ? new Date(movieData.release_date).getFullYear()
      : ''

    // 获取导演和演员信息
    const directors = (movieData as any).directors || []
    const cast = (movieData as any).cast || []
    const genres: any[] = (movieData as any).genres || []
    const runtime: number = (movieData as any).runtime || 0
    const productionCountries: any[] =
      (movieData as any).production_countries || []
    const productionCompanies: any[] =
      (movieData as any).production_companies || []

    // 生成类型 XML（Kodi 标准平展格式）
    const genresXml = genres
      .map((g: any) => `  <genre>${g.name}</genre>`)
      .join('\n')

    // 生成导演 XML（Kodi 标准平展格式）
    const directorsXml = directors
      .map((d: any) => `  <director>${d.name}</director>`)
      .join('\n')

    // 生成制片国家 XML
    const countriesXml = productionCountries
      .map((c: any) => `  <country>${c.name}</country>`)
      .join('\n')

    // 生成制片公司 XML
    const studiosXml = productionCompanies
      .map((s: any) => `  <studio>${s.name}</studio>`)
      .join('\n')

    // 生成演员 XML
    const castXml = cast
      .map(
        (actor: any) => `  <actor>
    <name>${actor.name}</name>
    ${actor.character ? `<role>${actor.character}</role>` : ''}
    ${actor.profile_path ? `<thumb>${getImageBaseUrl('actor')}${actor.profile_path}</thumb>` : ''}
    <profile>https://www.themoviedb.org/person/${actor.id}</profile>
    <tmdbid>${actor.id}</tmdbid>
  </actor>`
      )
      .join('\n')

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${movieData.title || ''}</title>
  <originaltitle>${movieData.original_title || movieData.title || ''}</originaltitle>
  <year>${releaseYear}</year>
  <ratings>
    <rating default="true" max="10" name="themoviedb">
      <value>${movieData.vote_average || 0}</value>
      <votes>${movieData.vote_count || 0}</votes>
    </rating>
  </ratings>
  <plot>${movieData.overview || ''}</plot>
  <outline>${movieData.overview || ''}</outline>
${runtime ? `  <runtime>${runtime}</runtime>` : ''}
${genresXml}
${countriesXml}
${studiosXml}
  <thumb aspect="poster">${movieData.poster_path || ''}</thumb>
  <thumb aspect="backdrop">${movieData.backdrop_path || ''}</thumb>
  <tmdbid>${movieData.id || 0}</tmdbid>
  <premiered>${movieData.release_date || ''}</premiered>
  <language>${movieData.original_language || ''}</language>
  <popularity>${movieData.popularity || 0}</popularity>
  <adult>${movieData.adult ? 'true' : 'false'}</adult>
${directorsXml}
${castXml}
</movie>`
  }

  /**
   * 检查文件夹中是否已有 NFO 文件和海报
   * @param folderPath 文件夹路径或文件路径
   * @param videoBaseName 视频文件基础名称
   * @returns 包含 NFO 内容和海报路径的对象
   */
  const checkExistingResources = async (
    folderPath: string,
    videoBaseName: string
  ): Promise<{
    hasNfo: boolean
    nfoContent: string | null
    hasPoster: boolean
    posterPath: string | null
    hasFanart: boolean
    fanartPath: string | null
  }> => {
    const result = {
      hasNfo: false,
      nfoContent: null as string | null,
      hasPoster: false,
      posterPath: null as string | null,
      hasFanart: false,
      fanartPath: null as string | null,
    }

    try {
      // 检查传入的路径是文件还是文件夹
      // 通过检查路径是否有文件扩展名来判断
      const hasExtension = /\.[^.]+$/.test(folderPath)

      let actualFolderPath = folderPath

      if (hasExtension) {
        actualFolderPath = await window.api.path.dirname(folderPath)
      }

      // 获取文件夹中的所有文件
      const folderFiles = await window.api.file.readdir(actualFolderPath)

      if (!folderFiles.success || !folderFiles.data) {
        return result
      }

      const files = folderFiles.data as Array<{
        name: string
        isDirectory: boolean
        isFile: boolean
      }>

      // 检查 NFO 文件
      const nfoFileName = `${videoBaseName}.nfo`
      const nfoFile = files.find(
        f => f.name.toLowerCase() === nfoFileName.toLowerCase()
      )

      if (nfoFile) {
        const nfoPath = await window.api.path.join(
          actualFolderPath,
          nfoFile.name
        )
        const nfoResult = await window.api.file.read(nfoPath)

        if (nfoResult.success && nfoResult.data) {
          result.hasNfo = true
          result.nfoContent = nfoResult.data as string
        }
      }

      // 检查海报文件
      const posterPatterns = [
        `${videoBaseName}-poster.jpg`,
        `${videoBaseName}-movie.jpg`,
        `${videoBaseName}-folder.jpg`,
        'poster.jpg',
        'folder.jpg',
        'movie.jpg',
      ]

      for (const pattern of posterPatterns) {
        const posterFile = files.find(
          f => f.name.toLowerCase() === pattern.toLowerCase()
        )
        if (posterFile) {
          result.hasPoster = true
          result.posterPath = await window.api.path.join(
            actualFolderPath,
            posterFile.name
          )
          break
        }
      }

      // 检查背景图文件
      const fanartPatterns = [
        `${videoBaseName}-fanart.jpg`,
        `${videoBaseName}-backdrop.jpg`,
        'fanart.jpg',
        'backdrop.jpg',
      ]

      for (const pattern of fanartPatterns) {
        const fanartFile = files.find(
          f => f.name.toLowerCase() === pattern.toLowerCase()
        )
        if (fanartFile) {
          result.hasFanart = true
          result.fanartPath = await window.api.path.join(
            actualFolderPath,
            fanartFile.name
          )
          break
        }
      }
    } catch (error) {
      console.error('检查已有资源时出错:', error)
    }

    return result
  }

  /**
   * 从 NFO 内容中解析电影信息
   * @param nfoContent NFO 文件内容
   * @returns 解析出的电影信息对象
   */
  const parseNfoContent = (nfoContent: string): Partial<Movie> => {
    const movieInfo: Partial<Movie> = {
      title: '',
      original_title: '',
      overview: '',
      release_date: '',
      vote_average: 0,
      vote_count: 0,
      poster_path: '',
      backdrop_path: '',
    }

    try {
      // 使用正则表达式提取各个字段
      const titleMatch = nfoContent.match(/<title>(.*?)<\/title>/)
      if (titleMatch) movieInfo.title = titleMatch[1]

      const originalTitleMatch = nfoContent.match(
        /<originaltitle>(.*?)<\/originaltitle>/
      )
      if (originalTitleMatch) movieInfo.original_title = originalTitleMatch[1]

      const plotMatch = nfoContent.match(/<plot>(.*?)<\/plot>/s)
      if (plotMatch) movieInfo.overview = plotMatch[1]

      const yearMatch = nfoContent.match(/<year>(.*?)<\/year>/)
      if (yearMatch) movieInfo.release_date = `${yearMatch[1]}-01-01`

      const ratingMatch = nfoContent.match(/<value>(.*?)<\/value>/)
      if (ratingMatch) movieInfo.vote_average = parseFloat(ratingMatch[1])

      const votesMatch = nfoContent.match(/<votes>(.*?)<\/votes>/)
      if (votesMatch) movieInfo.vote_count = parseInt(votesMatch[1])

      const tmdbIdMatch = nfoContent.match(/<tmdbid>(.*?)<\/tmdbid>/)
      if (tmdbIdMatch) {
        movieInfo.id = parseInt(tmdbIdMatch[1])
      }

      const thumbMatch = nfoContent.match(
        /<thumb aspect="poster"[^>]*>(.*?)<\/thumb>/s
      )
      if (thumbMatch) movieInfo.poster_path = thumbMatch[1]

      const fanartMatch = nfoContent.match(
        /<thumb aspect="backdrop"[^>]*>(.*?)<\/thumb>/s
      )
      if (fanartMatch) movieInfo.backdrop_path = fanartMatch[1]
    } catch (error) {
      console.error('解析 NFO 内容时出错:', error)
    }

    return movieInfo
  }

  return {
    scrapeMovieInFolder,
    cleanOldMovieFiles,
    handleSearchParams,
    searchMovieInfo,
    checkExistingResources,
    parseNfoContent,
  }
}
