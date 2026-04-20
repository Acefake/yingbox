import { TMDB_IMG_URL, tmdb } from '@/api/tmdb'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { ref } from 'vue'
import { ProcessedItem } from '@/types'

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
        const nfoFile = item.files.find(file => file.name.toLowerCase().endsWith('.nfo'))
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
            message.success('已从本地 NFO 加载电影信息')
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

      const cleanName = handleSearchParams(searchName)

      if (!cleanName) {
        console.error('清理后的名称为空')
        message.error('无法解析电影名称')
        return []
      }

      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined
      const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

      // 显示加载提示
      const loadingMessage = message.loading('正在搜索电影信息...', 0)

      try {
        let res = await tmdb.search.movies({
          query: nameWithoutYear || cleanName,
          language: 'zh-CN',
          ...(year && { year }),
        })
        console.log('搜索结果数量:', res.results.length)

        if (res.results.length === 0) {
          if (year) {
            res = await tmdb.search.movies({
              query: nameWithoutYear,
              language: 'zh-CN',
            })
          }

          if (res.results.length === 0) {
            res = await tmdb.search.movies({
              query: nameWithoutYear || cleanName,
              language: 'en-US',
              ...(year && { year }),
            })
          }
        }

        loadingMessage()

        if (res.results.length === 0) {
          console.error('所有搜索策略均无结果')
          message.error('未找到该电影')
          return []
        }
        const movies = res.results.map((movie: Movie) => ({
          ...movie,
          poster_path: movie.poster_path
            ? TMDB_IMG_URL + movie.poster_path
            : '',
          backdrop_path: movie.backdrop_path
            ? TMDB_IMG_URL + movie.backdrop_path
            : '',
          id: movie.id as number,
        })) as Movie[]
        console.log('处理后的电影列表:', movies.map(m => ({ title: m.title, id: m.id, hasBackdrop: !!m.backdrop_path })))
        return movies
      } catch (searchError) {
        loadingMessage()
        console.error('搜索电影时出错:', searchError)
        message.error('搜索电影时出错')
        return []
      }
    } catch (error) {
      console.error('自动刮削时出错:', error)
      message.error('自动刮削时出错')
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
            console.log(`已删除旧文件: ${await window.api.path.basename(filePath)}`)
          } else {
            console.error(`删除文件失败: ${await window.api.path.basename(filePath)}`)
          }
        } catch (error) {
          console.error(`删除文件时出错: ${error}`)
        }
      }

      if (filesToDelete.length > 0) {
        console.log(`已清理 ${filesToDelete.length} 个旧文件`)
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
      .replace(/\b(HDR\d*|DV|Dolby[\s.]?Vision|HLG|SDR|10bit|12bit|8bit)\b/gi, '')
      // 移除来源标记
      .replace(/\b(BluRay|Blu-?Ray|BDRip|BDRemux|REMUX|WEB-?DL|WEBRip|WEB|HDTV|DVDRip|DVD|HDDVD|NF|AMZN|DSNP|HULU|iTUNES)\b/gi, '')
      // 移除编码标记
      .replace(/\b(x264|x265|H[\s.]?264|H[\s.]?265|HEVC|AVC|VP9|AV1)\b/gi, '')
      // 移除音频标记
      .replace(/\b(AAC|DTS[\s-]?HD|DTS|TrueHD|Atmos|FLAC|AC3|EAC3|DD[\s.]?[257][\s.]?\d|DDP[\s.]?[257][\s.]?\d|MA[\s.]?[257][\s.]?\d)\b/gi, '')
      // 移除发布组 -GROUP 和 @GROUP
      .replace(/-[A-Za-z0-9@]+$/i, '')
      .replace(/@[A-Za-z0-9]+$/i, '')
      // 移除其它常见标记
      .replace(/\b(PROPER|REPACK|COMPLETE|V\d|DUBBED|SUBBED|MULTI|EXTENDED|UNCUT|REMASTERED|DIRECTORS[\s.]?CUT|LIMITED|INTERNAL|NFO|READNFO)\b/gi, '')
      // 清理多余空格
      .replace(/\s+/g, ' ')
      .trim()

    return cleanName
  }

  /**
   * 在指定文件夹中刮削电影信息（下载海报和创建NFO文件）
   * @param movieData 电影数据
   * @param folderPath 文件夹路径
   * @param videoBaseName 视频文件基础名称（不含扩展名）
   */
  const scrapeMovieInFolder = async (
    movieData: Movie,
    folderPath: string,
    videoBaseName: string
  ): Promise<void> => {
    try {
      const existingResources = await checkExistingResources(folderPath, videoBaseName)

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

      message.loading('正在清理旧文件并下载电影信息...', 0)

      await cleanOldMovieFiles(folderPath)

      // 构建文件路径
      const nfoFileName = `${videoBaseName}.nfo`

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

      const { directors, cast } = await getMovieCredits(movieData.id)
      console.log('演职员信息:', { directors, cast })

      // 将导演和演员信息添加到 movieData
      ;(movieData as any).directors = directors
      ;(movieData as any).cast = cast

      const nfoContent = createNfoContent(movieData)
      const nfoResult = await window.api.file.write(nfoPath, nfoContent)
      console.log('NFO写入结果:', nfoResult)

      if (!nfoResult.success) {
        throw new Error(`创建NFO文件失败: ${nfoResult.error}`)
      }

      if (movieData.poster_path) {
        const posterUrl = movieData.poster_path.startsWith('http')
          ? movieData.poster_path
          : `${TMDB_IMG_URL}${movieData.poster_path}`

        for (const { fileName, path } of posterPaths) {
          const posterResult = await window.api.http.download(posterUrl, path)
          console.log(`海报 ${fileName} 下载结果:`, posterResult)

          if (!posterResult.success) {
            console.error(`下载 ${fileName} 失败: ${posterResult.error}`)
          }
        }
      }

      if (movieData.backdrop_path) {
        const fanartUrl = movieData.backdrop_path.startsWith('http')
          ? movieData.backdrop_path
          : `${TMDB_IMG_URL}${movieData.backdrop_path}`

        for (const { fileName, path } of fanartPaths) {
          const fanartResult = await window.api.http.download(fanartUrl, path)
          console.log(`背景图 ${fileName} 下载结果:`, fanartResult)

          if (!fanartResult.success) {
            console.error(`下载 ${fileName} 失败: ${fanartResult.error}`)
          }
        }
      }

      message.destroy()
      message.success('电影信息刮削完成！')
    } catch (error) {
      message.destroy()
      console.error('刮削电影信息失败:', error)
      message.error(
        `刮削失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
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
      const credits = await tmdb.movies.credits(movieId)
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

    // 生成导演 XML
    const directorsXml = directors
      .map(
        (director: any) => `  <director>
    <name>${director.name}</name>
    ${director.profile_path ? `<thumb>${TMDB_IMG_URL}${director.profile_path}</thumb>` : ''}
    <profile>https://www.themoviedb.org/person/${director.id}</profile>
    <tmdbid>${director.id}</tmdbid>
  </director>`
      )
      .join('\n')

    // 生成演员 XML
    const castXml = cast
      .map(
        (actor: any) => `  <actor>
    <name>${actor.name}</name>
    ${actor.character ? `<role>${actor.character}</role>` : ''}
    ${actor.profile_path ? `<thumb>${TMDB_IMG_URL}${actor.profile_path}</thumb>` : ''}
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
  <thumb aspect="poster">${movieData.poster_path || ''}</thumb>
  <thumb aspect="backdrop">${movieData.backdrop_path || ''}</thumb>
  <tmdbid>${movieData.id || 0}</tmdbid>
  <premiered>${movieData.release_date || ''}</premiered>
  <language>${movieData.original_language || ''}</language>
  <popularity>${movieData.popularity || 0}</popularity>
  <adult>${movieData.adult ? 'true' : 'false'}</adult>
  <video>${movieData.video ? 'true' : 'false'}</video>
  <genreids>${(movieData.genre_ids || []).join(',')}</genreids>
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
      const nfoFile = files.find(f => f.name.toLowerCase() === nfoFileName.toLowerCase())

      if (nfoFile) {
        const nfoPath = await window.api.path.join(actualFolderPath, nfoFile.name)
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
          result.posterPath = await window.api.path.join(actualFolderPath, posterFile.name)
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
          result.fanartPath = await window.api.path.join(actualFolderPath, fanartFile.name)
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

      const originalTitleMatch = nfoContent.match(/<originaltitle>(.*?)<\/originaltitle>/)
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

      const thumbMatch = nfoContent.match(/<thumb aspect="poster"[^>]*>(.*?)<\/thumb>/s)
      if (thumbMatch) movieInfo.poster_path = thumbMatch[1]

      const fanartMatch = nfoContent.match(/<thumb aspect="backdrop"[^>]*>(.*?)<\/thumb>/s)
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
