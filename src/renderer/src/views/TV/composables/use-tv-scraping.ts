import { TMDB_IMG_URL, getTmdb } from '@/api/tmdb'
import { message } from 'ant-design-vue'
import { ref } from 'vue'
import { ProcessedItem, TVShowInfoType, SeasonInfo, EpisodeInfo } from '@/types'

/** 模块级 NFO 内容缓存：path → content，避免重复文件读取 */
const nfoContentCache = new Map<string, string>()

const getMetaLang = (): string =>
  (typeof window !== 'undefined' && localStorage.getItem('metadataLanguage')) ||
  'zh-CN'

/**
 * 将 Windows 本地路径转为 local:// URL（零 IPC）
 * e.g. "E:\\foo\\poster.jpg" → "local://e/foo/poster.jpg"
 */
function toLocalUrl(filePath: string): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/')
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch)
    return `local://${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
  return `local:///${normalized}`
}

/** 模块级解析结果缓存：path → TVShowInfo，避免重复 XML 解析 */
const tvInfoCache = new Map<string, TVShowInfoType>()

/** 模块级解析结果缓存：path → SeasonInfo[]，避免重复 XML 解析 */
const seasonsCache = new Map<string, SeasonInfo[]>()

/** 模块级季海报缓存：showPath → { seasonPath: posterUrl }，避免重复查找 */
const seasonPostersCache = new Map<string, Record<string, string>>()

/** 带缓存的 readText */
const cachedReadText = async (filePath: string): Promise<string> => {
  const cached = nfoContentCache.get(filePath)
  if (cached) return cached
  const result = await window.api.file.read(filePath)
  if (result.success && result.data) {
    const content = result.data as string
    nfoContentCache.set(filePath, content)
    return content
  }
  return ''
}

export const useTVScraping = () => {
  const currentScrapeItem = ref<ProcessedItem>()

  /**
   * 搜索电视剧
   * @param item 要刮削的项目（文件夹或视频文件）
   * @returns 搜索结果数组
   */
  const searchTVInfo = async (item: ProcessedItem): Promise<any[]> => {
    try {
      currentScrapeItem.value = item

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
        message.error('无法解析电视剧名称')
        return []
      }

      // 分离中文和英文部分
      const chinesePart = cleanName.match(/[\u4e00-\u9fa5]+/g)?.join(' ') || ''
      const englishPart = cleanName
        .replace(/[\u4e00-\u9fa5]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}(?!\w)\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined

      // 显示加载提示
      const loadingMessage = message.loading('正在搜索电视剧信息...', 0)

      try {
        let res: any = { results: [] }

        // 1. 优先用中文部分搜索（设定语言）
        if (chinesePart) {
          res = await getTmdb().search.tv({
            query: chinesePart,
            language: getMetaLang(),
            ...(year && { first_air_date_year: year }),
          })
        }

        // 2. 用英文部分搜索（设定语言）
        if (res.results.length === 0 && englishPart) {
          res = await getTmdb().search.tv({
            query: englishPart,
            language: getMetaLang(),
            ...(year && { first_air_date_year: year }),
          })
        }

        // 3. 用完整名称搜索（设定语言）
        if (res.results.length === 0) {
          res = await getTmdb().search.tv({
            query: cleanName,
            language: getMetaLang(),
          })
        }

        // 4. 最后 fallback：en-US（保底）
        if (res.results.length === 0) {
          res = await getTmdb().search.tv({
            query: englishPart || cleanName,
            language: 'en-US',
          })
        }

        loadingMessage()

        if (res.results.length === 0) {
          message.warning('未找到匹配的电视剧')
          return []
        }

        return res.results
      } catch (error) {
        loadingMessage()
        console.error('搜索电视剧失败:', error)
        message.error('搜索电视剧失败')
        return []
      }
    } catch (error) {
      console.error('搜索电视剧信息时出错:', error)
      message.error('搜索电视剧信息失败')
      return []
    }
  }

  /**
   * 获取电视剧详细信息
   * @param tvId TMDB电视剧ID
   * @returns 电视剧详细信息
   */
  const getTVDetails = async (tvId: number): Promise<any | null> => {
    try {
      const loadingMessage = message.loading('正在获取电视剧详细信息...', 0)

      const tvDetails = await getTmdb().tvShows.details(
        tvId,
        ['credits'],
        getMetaLang()
      )

      loadingMessage()
      return tvDetails
    } catch (error) {
      console.error('获取电视剧详细信息失败:', error)
      message.error('获取电视剧详细信息失败')
      return null
    }
  }

  /**
   * 获取季详细信息
   * @param tvId TMDB电视剧ID
   * @param seasonNumber 季数
   * @returns 季详细信息
   */
  const getSeasonDetails = async (
    tvId: number,
    seasonNumber: number
  ): Promise<SeasonInfo | null> => {
    try {
      const seasonDetails = await getTmdb().tvSeasons.details(
        { tvShowID: tvId, seasonNumber },
        undefined,
        { language: getMetaLang() }
      )

      // 转换为SeasonInfo格式
      const seasonInfo: SeasonInfo = {
        season_number: seasonDetails.season_number,
        name: seasonDetails.name,
        episode_count: seasonDetails.episodes?.length,
        air_date: seasonDetails.air_date,
        overview: seasonDetails.overview,
        poster_path: seasonDetails.poster_path ?? undefined,
        episodes:
          seasonDetails.episodes?.map(ep => ({
            episode_number: ep.episode_number,
            name: ep.name,
            overview: ep.overview,
            air_date: ep.air_date,
            vote_average: ep.vote_average,
            still_path: ep.still_path,
          })) || [],
      }

      return seasonInfo
    } catch (error) {
      console.error('获取季详细信息失败:', error)
      return null
    }
  }

  /**
   * 获取所有季信息
   * @param tvId TMDB电视剧ID
   * @returns 季信息数组
   */
  const getAllSeasons = async (tvId: number): Promise<SeasonInfo[]> => {
    try {
      const tvDetails = await getTmdb().tvShows.details(
        tvId,
        undefined,
        getMetaLang()
      )

      if (!tvDetails.seasons) {
        return []
      }

      const seasons: SeasonInfo[] = []

      for (const season of tvDetails.seasons) {
        if (season.season_number > 0) {
          // 跳过Specials季
          const seasonInfo = await getSeasonDetails(tvId, season.season_number)
          if (seasonInfo) {
            seasons.push(seasonInfo)
          }
        }
      }

      return seasons
    } catch (error) {
      console.error('获取所有季信息失败:', error)
      message.error('获取所有季信息失败')
      return []
    }
  }

  /**
   * 转换TMDB电视剧数据为TVShowInfoType格式
   * @param tvData TMDB电视剧数据
   * @returns TVShowInfoType格式数据
   */
  const convertToTVShowInfo = (tvData: any): TVShowInfoType => {
    const creators = tvData.created_by?.map(c => c.name).join(' / ') || ''
    const genres = tvData.genres?.map(g => g.name) || []
    const networks = tvData.networks?.map(n => n.name).join(' / ') || ''

    return {
      title: tvData.name,
      originaltitle: tvData.original_name,
      year: tvData.first_air_date
        ? tvData.first_air_date.substring(0, 4)
        : undefined,
      plot: tvData.overview,
      genre: genres,
      director: creators,
      actor: [],
      rating: tvData.vote_average?.toString(),
      premiered: tvData.first_air_date,
      status: tvData.status,
      network: networks,
      number_of_seasons: tvData.number_of_seasons,
      number_of_episodes: tvData.number_of_episodes,
    }
  }

  /**
   * 生成电视剧tvshow.nfo内容
   * @param tvData TMDB电视剧数据
   * @returns NFO XML内容
   */
  const generateTVShowNFO = (tvData: any): string => {
    const tvInfo = convertToTVShowInfo(tvData)
    const creators = tvData.created_by?.map(c => c.name).join(' / ') || ''
    const genres = tvData.genres?.map(g => g.name).join(' / ') || ''
    const studios =
      tvData.production_companies?.map(c => c.name).join(' / ') || ''
    const countries =
      tvData.production_countries?.map(c => c.name).join(' / ') || ''

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${escapeXml(tvInfo.title || '')}</title>
  <originaltitle>${escapeXml(tvInfo.originaltitle || '')}</originaltitle>
  <showtitle>${escapeXml(tvInfo.title || '')}</showtitle>
  <sorttitle>${escapeXml(tvInfo.title || '')}</sorttitle>
  <year>${tvInfo.year || ''}</year>
  <plot>${escapeXml(tvInfo.plot || '')}</plot>
  <outline>${escapeXml(tvInfo.plot || '')}</outline>
  <tagline></tagline>
  <runtime></runtime>
  <mpaa></mpaa>
  <id>${tvData.id}</id>
  <tmdbid>${tvData.id}</tmdbid>
  <imdbid>${tvData.external_ids?.imdb_id || ''}</imdbid>
  <premiered>${tvInfo.premiered || ''}</premiered>
  <rating>${tvInfo.rating || '0'}</rating>
  <votes>${tvData.vote_count || 0}</votes>
  <popularity>${tvData.popularity || 0}</popularity>
  <status>${escapeXml(tvInfo.status || '')}</status>
  <genre>${escapeXml(genres)}</genre>
  <country>${escapeXml(countries)}</country>
  <studio>${escapeXml(studios)}</studio>
  <network>${escapeXml(tvInfo.network || '')}</network>
  <director>${escapeXml(creators)}</director>
  <actor>
    ${
      tvData.credits?.cast
        ?.slice(0, 10)
        .map(
          a => `
    <actor>
      <name>${escapeXml(a.name)}</name>
      <role>${escapeXml(a.character || '')}</role>
      <thumb>${a.profile_path ? TMDB_IMG_URL + a.profile_path : ''}</thumb>
    </actor>`
        )
        .join('') || ''
    }
  </actor>
  <poster>${tvData.poster_path ? TMDB_IMG_URL + tvData.poster_path : ''}</poster>
  <fanart>${tvData.backdrop_path ? TMDB_IMG_URL + tvData.backdrop_path : ''}</fanart>
</tvshow>`
  }

  /**
   * 生成季season.nfo内容
   * @param tvData TMDB电视剧数据
   * @param seasonInfo 季信息
   * @returns NFO XML内容
   */
  const generateSeasonNFO = (_tvData: any, seasonInfo: SeasonInfo): string => {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<season>
  <title>${escapeXml(seasonInfo.name || `Season ${seasonInfo.season_number}`)}</title>
  <seasonnumber>${seasonInfo.season_number}</seasonnumber>
  <plot>${escapeXml(seasonInfo.overview || '')}</plot>
  <aired>${seasonInfo.air_date || ''}</aired>
  <episodecount>${seasonInfo.episode_count || 0}</episodecount>
  <poster>${seasonInfo.poster_path ? TMDB_IMG_URL + seasonInfo.poster_path : ''}</poster>
</season>`
  }

  /**
   * 生成集episode.nfo内容
   * @param tvData TMDB电视剧数据
   * @param seasonNumber 季数
   * @param episodeInfo 集信息
   * @returns NFO XML内容
   */
  const generateEpisodeNFO = (
    tvData: any,
    seasonNumber: number,
    episodeInfo: EpisodeInfo
  ): string => {
    const creators = tvData.created_by?.map(c => c.name).join(' / ') || ''
    const genres = tvData.genres?.map(g => g.name).join(' / ') || ''
    const studios =
      tvData.production_companies?.map(c => c.name).join(' / ') || ''

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>${escapeXml(episodeInfo.name || '')}</title>
  <showtitle>${escapeXml(tvData.name || '')}</showtitle>
  <season>${seasonNumber}</season>
  <episode>${episodeInfo.episode_number}</episode>
  <plot>${escapeXml(episodeInfo.overview || '')}</plot>
  <outline>${escapeXml(episodeInfo.overview || '')}</outline>
  <aired>${episodeInfo.air_date || ''}</aired>
  <rating>${episodeInfo.vote_average || 0}</rating>
  <votes></votes>
  <displayseason>${seasonNumber}</displayseason>
  <displayepisode>${episodeInfo.episode_number}</displayepisode>
  <mpaa></mpaa>
  <id>${tvData.id}</id>
  <tmdbid>${tvData.id}</tmdbid>
  <imdbid>${tvData.external_ids?.imdb_id || ''}</imdbid>
  <genre>${escapeXml(genres)}</genre>
  <country></country>
  <studio>${escapeXml(studios)}</studio>
  <director>${escapeXml(creators)}</director>
  <actor>
    ${
      tvData.credits?.cast
        ?.slice(0, 10)
        .map(
          a => `
    <actor>
      <name>${escapeXml(a.name)}</name>
      <role>${escapeXml(a.character || '')}</role>
      <thumb>${a.profile_path ? TMDB_IMG_URL + a.profile_path : ''}</thumb>
    </actor>`
        )
        .join('') || ''
    }
  </actor>
  <thumb>${episodeInfo.still_path ? TMDB_IMG_URL + episodeInfo.still_path : ''}</thumb>
</episodedetails>`
  }

  /**
   * 转义XML特殊字符
   */
  const escapeXml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  /**
   * 下载图片到本地路径
   */
  const downloadImage = async (
    url: string,
    destPath: string
  ): Promise<void> => {
    const result = await window.api.http.download(url, destPath)
    if (!result.success) {
      console.warn(`下载图片失败 [${destPath}]:`, result.error)
    }
  }

  /**
   * 写文本文件
   */
  const writeTextFile = async (
    filePath: string,
    content: string
  ): Promise<void> => {
    const result = await window.api.file.write(filePath, content)
    if (!result.success) {
      throw new Error(`写入文件失败 [${filePath}]: ${result.error}`)
    }
  }

  /**
   * 完整刮削：下载 tvshow.nfo / poster.jpg / fanart.jpg 到剧集根目录，
   * 以及每季的 season.nfo / seasonNN-poster.jpg 和每集的 episode.nfo
   */
  const scrapeTVShow = async (
    item: ProcessedItem,
    tvDetails: any,
    seasons: SeasonInfo[]
  ): Promise<void> => {
    const showPath = item.path

    message.loading('正在刮削电视剧...', 0)

    try {
      // 1. tvshow.nfo
      const nfoContent = generateTVShowNFO(tvDetails)
      await writeTextFile(
        await window.api.path.join(showPath, 'tvshow.nfo'),
        nfoContent
      )

      // 2. poster.jpg
      if (tvDetails.poster_path) {
        await downloadImage(
          `${TMDB_IMG_URL}${tvDetails.poster_path}`,
          await window.api.path.join(showPath, 'poster.jpg')
        )
      }

      // 3. fanart.jpg
      if (tvDetails.backdrop_path) {
        await downloadImage(
          `${TMDB_IMG_URL}${tvDetails.backdrop_path}`,
          await window.api.path.join(showPath, 'fanart.jpg')
        )
      }

      // 4. 检查并创建季文件夹（如果不存在）
      let seasonFolders = (item.children || []).filter(c => c.isSeasonFolder)

      // 如果没有季文件夹，先根据文件名中的季信息自动组织文件
      if (seasonFolders.length === 0) {
        // 递归读取目录
        const readDirectoryRecursive = async (
          dirPath: string
        ): Promise<any[]> => {
          const allFiles: any[] = []
          try {
            const result = await window.api.file.readdir(dirPath)
            if (!result.success || !result.data) {
              return allFiles
            }

            const items = result.data as Array<{
              name: string
              isDirectory: boolean
              isFile: boolean
            }>

            for (const item of items) {
              const fullPath = await window.api.path.join(dirPath, item.name)
              const statResult = await window.api.file.stat(fullPath)

              if (!statResult.success || !statResult.data) {
                continue
              }

              const stat = statResult.data as {
                size: number
                isDirectory: boolean
                isFile: boolean
              }

              allFiles.push({
                name: item.name,
                path: fullPath,
                size: stat.size,
                isDirectory: stat.isDirectory,
                isFile: stat.isFile,
              })

              if (item.isDirectory) {
                try {
                  const subFiles = await readDirectoryRecursive(fullPath)
                  allFiles.push(...subFiles)
                } catch {
                  // 跳过无法读取的目录
                }
              }
            }
          } catch {
            // 跳过无法读取的目录
          }

          return allFiles
        }

        const files = await readDirectoryRecursive(showPath)

        // 按季分组视频文件
        const seasonGroups: Record<number, any[]> = {}
        const extractSeasonFromFilename = (filename: string): number | null => {
          const base = filename.replace(/\.[^.]+$/, '')
          const match = base.match(/s(\d+)/i)
          return match ? parseInt(match[1]) : null
        }
        const isVideoFile = (name: string): boolean => {
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
          return videoExtensions.some(ext => name.toLowerCase().endsWith(ext))
        }

        for (const file of files) {
          if (!file.isFile || !isVideoFile(file.name)) continue
          const seasonNum = extractSeasonFromFilename(file.name)
          if (seasonNum !== null) {
            if (!seasonGroups[seasonNum]) {
              seasonGroups[seasonNum] = []
            }
            seasonGroups[seasonNum].push(file)
          }
        }

        // 创建季文件夹并移动文件
        for (const [seasonNum, seasonFiles] of Object.entries(seasonGroups)) {
          const seasonFolderName = `Season ${seasonNum}`
          const seasonFolderPath = await window.api.path.join(
            showPath,
            seasonFolderName
          )

          const existsCheck = await window.api.file.exists(seasonFolderPath)
          if (!existsCheck.success || !existsCheck.exists) {
            await window.api.file.mkdir(seasonFolderPath)
          }

          // 移动文件到季文件夹
          for (const file of seasonFiles) {
            const newPath = await window.api.path.join(
              seasonFolderPath,
              file.name
            )
            const moveResult = await window.api.file.move(file.path, newPath)
            if (moveResult.success) {
              // 同时移动关联的缩略图文件
              const baseName = file.name.replace(/\.[^.]+$/, '')
              const thumbName = `${baseName}-thumb.jpg`
              const thumbPath = await window.api.path.join(showPath, thumbName)
              const thumbExists = await window.api.file.exists(thumbPath)
              if (thumbExists.success && thumbExists.exists) {
                const newThumbPath = await window.api.path.join(
                  seasonFolderPath,
                  thumbName
                )
                const thumbMoveResult = await window.api.file.move(
                  thumbPath,
                  newThumbPath
                )
                if (thumbMoveResult.success) {
                }
              }
            }
          }
        }

        // 根据 TMDB 季信息创建缺失的季文件夹
        for (const season of seasons) {
          const seasonFolderName = `Season ${season.season_number}`
          const seasonFolderPath = await window.api.path.join(
            showPath,
            seasonFolderName
          )

          await window.api.file.exists(seasonFolderPath)
        }

        // 重新读取目录结构以更新 in-memory 表示
        const updatedFiles = await readDirectoryRecursive(showPath)

        // 更新 item.children 以反映新的文件结构
        // 简化处理：重新构建 ProcessedItem 结构
        const isTVSeasonFolder = (name: string): boolean => {
          const lowerName = name.toLowerCase()
          return /^season\s*\d+/i.test(lowerName) || /^s\d+/i.test(lowerName)
        }
        const extractSeasonNumber = (name: string): number => {
          const match = name.match(/season\s*(\d+)/i) || name.match(/s(\d+)/i)
          return match ? parseInt(match[1]) : 0
        }
        const extractEpisodeNumber = (name: string): number => {
          const base = name.replace(/\.[^.]+$/, '')
          let m: RegExpMatchArray | null
          m = base.match(/s\d+e(\d+)/i)
          if (m) return parseInt(m[1])
          m = base.match(/\d+x(\d+)/i)
          if (m) return parseInt(m[1])
          m = base.match(/\bep\.?\s*(\d+)/i)
          if (m) return parseInt(m[1])
          m = base.match(/\bE(\d{1,3})\b/)
          if (m) return parseInt(m[1])
          m = base.match(/第\s*(\d+)\s*集/)
          if (m) return parseInt(m[1])
          return 0
        }

        // 重新构建 children
        const newChildren: any[] = []
        for (const file of updatedFiles) {
          if (file.path === showPath) continue // 跳过根目录

          const parentPath = file.path.substring(
            0,
            file.path.lastIndexOf(file.path.includes('\\') ? '\\' : '/')
          )
          if (parentPath !== showPath) continue // 只处理直接子项

          if (file.isDirectory && isTVSeasonFolder(file.name)) {
            // 季文件夹
            newChildren.push({
              name: file.name,
              path: file.path,
              type: 'folder',
              isSeasonFolder: true,
              seasonNumber: extractSeasonNumber(file.name),
              children: [], // 稍后填充
            })
          } else if (file.isFile) {
            // 视频文件
            newChildren.push({
              name: file.name,
              path: file.path,
              type: 'video',
              episodeNumber: extractEpisodeNumber(file.name),
            })
          }
        }

        // 为每个季文件夹填充子文件
        for (const seasonChild of newChildren.filter(c => c.isSeasonFolder)) {
          for (const file of updatedFiles) {
            const parentPath = file.path.substring(
              0,
              file.path.lastIndexOf(file.path.includes('\\') ? '\\' : '/')
            )
            if (parentPath === seasonChild.path && file.isFile) {
              seasonChild.children.push({
                name: file.name,
                path: file.path,
                type: 'video',
                episodeNumber: extractEpisodeNumber(file.name),
              })
            }
          }
        }

        // 更新 item.children
        item.children = newChildren
      }

      // 5. 季与集处理
      seasonFolders = (item.children || []).filter(c => c.isSeasonFolder)

      for (const seasonFolder of seasonFolders) {
        const sNum = seasonFolder.seasonNumber ?? 0
        const seasonData = seasons.find(s => s.season_number === sNum)

        // season.nfo
        if (seasonData) {
          const seasonNfo = generateSeasonNFO(tvDetails, seasonData)
          const seasonNfoPath = await window.api.path.join(
            seasonFolder.path,
            'season.nfo'
          )

          // 确保季文件夹存在
          const seasonExists = await window.api.file.exists(seasonFolder.path)
          if (!seasonExists.success || !seasonExists.exists) {
            continue
          }

          await writeTextFile(seasonNfoPath, seasonNfo)
        }

        // seasonNN-poster.jpg  e.g. season01-poster.jpg
        const seasonPosterFile = `season${String(sNum).padStart(2, '0')}-poster.jpg`
        const seasonPosterPath = seasonData?.poster_path
          ? `${TMDB_IMG_URL}${seasonData.poster_path}`
          : null

        if (seasonPosterPath) {
          await downloadImage(
            seasonPosterPath,
            await window.api.path.join(seasonFolder.path, seasonPosterFile)
          )
        }

        // 集：重命名视频 + 写 NFO + 下载缩略图
        if (seasonData) {
          const episodeDetails: EpisodeInfo[] = seasonData.episodes || []
          const videoFiles = (seasonFolder.children || []).filter(
            c => c.type === 'video'
          )
          const showName = sanitizeFilename(
            tvDetails.name || tvDetails.original_name || ''
          )

          for (const video of videoFiles) {
            const epNum = video.episodeNumber ?? 0
            const epData = episodeDetails.find(e => e.episode_number === epNum)
            if (!epData) continue

            // 构造标准基本名: 剧名-S01E01-集名
            const epName = sanitizeFilename(epData.name || '')
            const sTag = `S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
            const newBaseName = epName
              ? `${showName}-${sTag}-${epName}`
              : `${showName}-${sTag}`

            // ── 重命名视频文件 ──
            const ext = await window.api.path.extname(video.name)
            const newVideoName = `${newBaseName}${ext}`
            if (video.name !== newVideoName) {
              const newVideoPath = await window.api.path.join(
                seasonFolder.path,
                newVideoName
              )
              const moveResult = await window.api.file.move(
                video.path,
                newVideoPath
              )
              if (moveResult.success) {
                // 同步更新 ProcessedItem（内存中），后续 loadLocalTVInfo 才能找到对应文件
                video.name = newVideoName
                video.path = newVideoPath
              } else {
                console.warn(
                  `重命名视频失败 [${video.name}]:`,
                  moveResult.error
                )
              }
            }

            // ── 集 NFO ──
            const epNfo = generateEpisodeNFO(tvDetails, sNum, epData)
            await writeTextFile(
              await window.api.path.join(
                seasonFolder.path,
                `${newBaseName}.nfo`
              ),
              epNfo
            )

            // ── 集缩略图 ──
            if (epData.still_path) {
              await downloadImage(
                `${TMDB_IMG_URL}${epData.still_path}`,
                await window.api.path.join(
                  seasonFolder.path,
                  `${newBaseName}-thumb.jpg`
                )
              )
            }
          }
        }
      }

      // 重命名剧集文件夹为 "剧名(年份)" 格式（在所有文件操作完成后）
      const showName = sanitizeFilename(
        tvDetails.name || tvDetails.original_name || ''
      )
      const year = tvDetails.first_air_date
        ? tvDetails.first_air_date.substring(0, 4)
        : ''
      const newFolderName = year ? `${showName}(${year})` : showName
      const currentFolderName = await window.api.path.basename(showPath)

      if (currentFolderName !== newFolderName) {
        const parentPath = await window.api.path.dirname(showPath)
        const newShowPath = await window.api.path.join(
          parentPath,
          newFolderName
        )
        const renameResult = await window.api.file.move(showPath, newShowPath)
        if (renameResult.success) {
          item.path = newShowPath
          item.name = newFolderName
        }
      }

      message.destroy()
      message.success('电视剧刮削完成！')
    } catch (error) {
      message.destroy()
      console.error('刮削失败:', error)
      message.error(
        `刮削失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  /**
   * 解析 tvshow.nfo 内容，返回 TVShowInfoType
   */
  const parseTVShowNFO = (content: string): TVShowInfoType => {
    const get = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
      return m ? m[1].trim() : undefined
    }
    const getAll = (tag: string) => {
      const matches =
        content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gi')) || []
      return matches
        .map(m => m.replace(new RegExp(`</?${tag}>`, 'gi'), '').trim())
        .filter(Boolean)
    }

    return {
      title: get('title'),
      originaltitle: get('originaltitle'),
      year: get('year'),
      plot: get('plot'),
      genre: getAll('genre'),
      director: get('director'),
      actor: getAll('name'),
      rating: get('rating'),
      premiered: get('premiered'),
      status: get('status'),
      network: get('network'),
    }
  }

  /**
   * 解析 season.nfo 内容，返回 SeasonInfo
   */
  const parseSeasonNFO = (content: string): SeasonInfo => {
    const get = (tag: string) => {
      const m = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
      return m ? m[1].trim() : undefined
    }
    return {
      season_number: parseInt(get('seasonnumber') || '0'),
      name: get('title'),
      overview: get('plot'),
      air_date: get('aired'),
      episode_count: parseInt(get('episodecount') || '0') || undefined,
      poster_path: get('poster'),
    }
  }

  /**
   * 从本地目录读取 tvshow.nfo / poster.jpg / 各季 NFO+海报
   * 不加载集缩略图（由 loadEpisodeThumbs 按需加载）
   */
  const loadLocalTVInfo = async (
    item: ProcessedItem
  ): Promise<{
    tvInfo: TVShowInfoType | null
    posterDataUrl: string
    fanartDataUrl: string
    seasonPosters: Record<string, string>
  }> => {
    const result: {
      tvInfo: TVShowInfoType | null
      posterDataUrl: string
      fanartDataUrl: string
      seasonPosters: Record<string, string>
    } = {
      tvInfo: null,
      posterDataUrl: '',
      fanartDataUrl: '',
      seasonPosters: {},
    }

    // 检查是否所有数据都已缓存（秒开路径）
    const cachedTvInfo = tvInfoCache.get(item.path)
    const cachedSeasons = seasonsCache.get(item.path)
    const cachedSeasonPosters = seasonPostersCache.get(item.path)
    const sep = item.path.includes('\\') ? '\\' : '/'
    const posterPath = item.path + sep + 'poster.jpg'
    const fanartPath = item.path + sep + 'fanart.jpg'
    const nfoPath = item.path + sep + 'tvshow.nfo'

    // 如果所有数据都已缓存，直接返回（秒开）
    if (cachedTvInfo && cachedSeasons && cachedSeasonPosters) {
      result.tvInfo = cachedTvInfo
      const [pr, fr] = await Promise.all([
        window.api.file
          .readImage(posterPath)
          .catch(() => ({ success: false, data: null }) as any),
        window.api.file
          .readImage(fanartPath)
          .catch(() => ({ success: false, data: null }) as any),
      ])
      result.posterDataUrl = pr.success && pr.data ? (pr.data as string) : ''
      result.fanartDataUrl = fr.success && fr.data ? (fr.data as string) : ''
      result.tvInfo.seasons = cachedSeasons.sort(
        (a, b) => a.season_number - b.season_number
      )
      result.seasonPosters = cachedSeasonPosters
      return result
    }

    const [nfoCheck, posterResult, fanartResult] = await Promise.all([
      window.api.file.exists(nfoPath),
      window.api.file
        .readImage(posterPath)
        .catch(() => ({ success: false, data: null }) as any),
      window.api.file
        .readImage(fanartPath)
        .catch(() => ({ success: false, data: null }) as any),
    ])

    result.posterDataUrl =
      posterResult.success && posterResult.data
        ? (posterResult.data as string)
        : ''
    result.fanartDataUrl =
      fanartResult.success && fanartResult.data
        ? (fanartResult.data as string)
        : ''

    if (cachedTvInfo) {
      result.tvInfo = cachedTvInfo
    } else if (nfoCheck.success && nfoCheck.exists) {
      const content = await cachedReadText(nfoPath).catch(() => '')
      if (content) {
        const parsed = parseTVShowNFO(content)
        result.tvInfo = parsed
        tvInfoCache.set(item.path, parsed)
      }
    }

    // 并行加载各季 NFO + 海报
    const seasonFolders = (item.children || []).filter(
      c => c.isSeasonFolder && c.seasonNumber !== undefined
    )
    const seasonsKey = item.path
    let parsedSeasons: SeasonInfo[] = []

    if (cachedSeasons) {
      parsedSeasons = cachedSeasons
      if (cachedSeasonPosters) {
        result.seasonPosters = cachedSeasonPosters
      }
    } else {
      await Promise.all(
        seasonFolders.map(async sf => {
          const sfSep = sf.path.includes('\\') ? '\\' : '/'
          const nfoP = sf.path + sfSep + 'season.nfo'
          const posterP =
            sf.path +
            sfSep +
            `season${String(sf.seasonNumber).padStart(2, '0')}-poster.jpg`

          // 季海报用 readImage IPC 读为 base64
          const seasonPosterResult = await window.api.file
            .readImage(posterP)
            .catch(() => ({ success: false, data: null }) as any)
          if (seasonPosterResult.success && seasonPosterResult.data) {
            result.seasonPosters[sf.path] = seasonPosterResult.data as string
          }

          // NFO 仍需读文件
          const nfoC = await window.api.file
            .exists(nfoP)
            .catch(() => ({ success: false, exists: false }))
          if (nfoC.success && nfoC.exists) {
            const content = await cachedReadText(nfoP).catch(() => '')
            if (content) parsedSeasons.push(parseSeasonNFO(content))
          }
        })
      )

      if (parsedSeasons.length > 0) {
        seasonsCache.set(seasonsKey, parsedSeasons)
      }
      if (Object.keys(result.seasonPosters).length > 0) {
        seasonPostersCache.set(seasonsKey, result.seasonPosters)
      }
    }

    if (result.tvInfo && parsedSeasons.length > 0) {
      result.tvInfo.seasons = parsedSeasons.sort(
        (a, b) => a.season_number - b.season_number
      )
    }

    return result
  }

  /**
   * 按需加载单个季文件夹下的集缩略图（带缓存）
   */
  const loadEpisodeThumbs = async (
    seasonFolder: ProcessedItem
  ): Promise<Record<string, string>> => {
    const thumbs: Record<string, string> = {}
    const videos = (seasonFolder.children || []).filter(c => c.type === 'video')

    const sfSep = seasonFolder.path.includes('\\') ? '\\' : '/'
    await Promise.all(
      videos.map(async v => {
        const baseName = v.name.replace(/\.[^.]+$/, '')
        const thumbPath = seasonFolder.path + sfSep + baseName + '-thumb.jpg'
        const exists = await window.api.file
          .exists(thumbPath)
          .catch(() => ({ success: false, exists: false }))
        if (exists.success && exists.exists) {
          thumbs[v.path] = toLocalUrl(thumbPath)
        }
      })
    )

    return thumbs
  }

  /**
   * 预加载剧集的 poster、fanart、NFO 和所有季数据（仅填充缓存，不返回数据）
   * 用于 hover 时预加载，实现无卡顿切换
   */
  const preloadShowImages = async (item: ProcessedItem): Promise<void> => {
    const iSep = item.path.includes('\\') ? '\\' : '/'
    const nfoPath = item.path + iSep + 'tvshow.nfo'

    // 如果 NFO 已缓存，跳过读取
    if (!tvInfoCache.has(item.path)) {
      const nfoCheck = await window.api.file
        .exists(nfoPath)
        .catch(() => ({ success: false, exists: false }))
      if (nfoCheck.success && nfoCheck.exists) {
        const content = await cachedReadText(nfoPath).catch(() => '')
        if (content) {
          tvInfoCache.set(item.path, parseTVShowNFO(content))
        }
      }
    }

    // 季数据预加载
    const seasonFolders = (item.children || []).filter(
      c => c.isSeasonFolder && c.seasonNumber !== undefined
    )
    const seasonsKey = item.path

    if (!seasonsCache.has(seasonsKey)) {
      const loadedSeasonPosters: Record<string, string> = {}
      const loadedSeasonNFOs: SeasonInfo[] = []

      await Promise.all(
        seasonFolders.map(async sf => {
          const sfSep2 = sf.path.includes('\\') ? '\\' : '/'
          const nfoP = sf.path + sfSep2 + 'season.nfo'
          const posterP =
            sf.path +
            sfSep2 +
            `season${String(sf.seasonNumber).padStart(2, '0')}-poster.jpg`

          // 季海报直接 local:// URL
          loadedSeasonPosters[sf.path] = toLocalUrl(posterP)

          // NFO 仅在存在时读取
          const nfoC = await window.api.file
            .exists(nfoP)
            .catch(() => ({ success: false, exists: false }))
          if (nfoC.success && nfoC.exists) {
            const content = await cachedReadText(nfoP).catch(() => '')
            if (content) loadedSeasonNFOs.push(parseSeasonNFO(content))
          }
        })
      )

      if (loadedSeasonNFOs.length > 0)
        seasonsCache.set(seasonsKey, loadedSeasonNFOs)
      if (Object.keys(loadedSeasonPosters).length > 0)
        seasonPostersCache.set(seasonsKey, loadedSeasonPosters)
    }
  }

  /**
   * 清理文件名中的非法字符，用于生成安全的文件名
   */
  const sanitizeFilename = (name: string): string => {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * 处理搜索参数，清理文件名中的标记，提取纯剧名用于 TMDB 搜索
   */
  const handleSearchParams = (name: string): string => {
    let cleanName = name
      // 移除文件扩展名
      .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|rmvb)$/i, '')

    // 剧名永远在季集标记之前：遇到 S\d+ / Season\d+ / \d+x\d+ 就截断后面所有内容
    const cutMatch = cleanName.match(
      /[._\s-](?:S\d+(?:E\d+)?|Season[\s._]*\d+|\d+x\d+)(?:[._\s-]|$)/i
    )
    if (cutMatch && cutMatch.index !== undefined) {
      cleanName = cleanName.slice(0, cutMatch.index)
    }

    cleanName = cleanName
      // 把点和下划线替换为空格（场景发布组常用）
      .replace(/[._]/g, ' ')
      // 移除括号内容 [] () 【】（）
      .replace(/\s*[\[\(【（].*?[\]\)】）]\s*/g, ' ')
      // 移除年份（单独的19xx或20xx）
      .replace(/\b(19|20)\d{2}(?!\w)\b/g, '')
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
   * 刮削当前季：读 tvshow.nfo → tmdbid，下载季海报 + 写所有集 NFO + 下载所有缩略图
   * @param tvShowRoot  剧集根 ProcessedItem
   * @param seasonFolder 当前季文件夹 ProcessedItem
   * @returns 更新后的季海报 data URL 和集缩略图 map
   */
  const scrapeSeason = async (
    tvShowRoot: ProcessedItem,
    seasonFolder: ProcessedItem
  ): Promise<{
    seasonPosterDataUrl: string
    thumbs: Record<string, string>
  }> => {
    const empty = { seasonPosterDataUrl: '', thumbs: {} }
    const showSep = tvShowRoot.path.includes('\\') ? '\\' : '/'
    const nfoPath = tvShowRoot.path + showSep + 'tvshow.nfo'

    const nfoContent = await cachedReadText(nfoPath).catch(() => '')
    const tmdbIdMatch = nfoContent.match(/<tmdbid>(\d+)<\/tmdbid>/i)
    if (!tmdbIdMatch) {
      message.error('未找到 TMDB ID，请先刮削整部剧集')
      return empty
    }
    const tmdbId = parseInt(tmdbIdMatch[1])
    const sNum = seasonFolder.seasonNumber ?? 1
    const sep = seasonFolder.path.includes('\\') ? '\\' : '/'

    message.loading(`正在刮削第 ${sNum} 季...`, 0)
    try {
      // 2. 拉取剧集详情 + 季详情
      const [tvDetails, seasonData] = await Promise.all([
        getTVDetails(tmdbId),
        getSeasonDetails(tmdbId, sNum),
      ])
      if (!tvDetails) throw new Error('无法获取剧集详情')
      if (!seasonData) throw new Error(`无法获取第 ${sNum} 季数据`)

      // 3. 写 season.nfo
      const seasonNfo = generateSeasonNFO(tvDetails, seasonData)
      await writeTextFile(seasonFolder.path + sep + 'season.nfo', seasonNfo)

      // 4. 下载季海报
      const seasonPosterFile = `season${String(sNum).padStart(2, '0')}-poster.jpg`
      const seasonPosterDest = seasonFolder.path + sep + seasonPosterFile
      if (seasonData.poster_path) {
        await downloadImage(
          `${TMDB_IMG_URL}${seasonData.poster_path}`,
          seasonPosterDest
        )
      }

      // 5. 遍历集：重命名视频 + 写 NFO + 下载缩略图
      const episodeDetails: EpisodeInfo[] = seasonData.episodes || []
      const videoFiles = (seasonFolder.children || []).filter(
        c => c.type === 'video'
      )
      const showName = sanitizeFilename(
        tvDetails.name || tvDetails.original_name || ''
      )
      const thumbs: Record<string, string> = {}

      for (const video of videoFiles) {
        const epNum = video.episodeNumber ?? 0
        const epData = episodeDetails.find(e => e.episode_number === epNum)
        if (!epData) continue

        const epName = sanitizeFilename(epData.name || '')
        const sTag = `S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
        const newBaseName = epName
          ? `${showName}-${sTag}-${epName}`
          : `${showName}-${sTag}`

        // 重命名视频
        const ext = await window.api.path.extname(video.name)
        const newVideoName = `${newBaseName}${ext}`
        if (video.name !== newVideoName) {
          const newVideoPath = await window.api.path.join(
            seasonFolder.path,
            newVideoName
          )
          const moveResult = await window.api.file.move(
            video.path,
            newVideoPath
          )
          if (moveResult.success) {
            video.name = newVideoName
            video.path = newVideoPath
          }
        }

        // 写 episode NFO
        await writeTextFile(
          await window.api.path.join(seasonFolder.path, `${newBaseName}.nfo`),
          generateEpisodeNFO(tvDetails, sNum, epData)
        )

        // 下载缩略图并读为 data URL
        const thumbPath = seasonFolder.path + sep + `${newBaseName}-thumb.jpg`
        if (epData.still_path) {
          await downloadImage(`${TMDB_IMG_URL}${epData.still_path}`, thumbPath)
          const thumbResult = await window.api.file
            .readImage(thumbPath)
            .catch(() => ({ success: false, data: null }) as any)
          if (thumbResult.success && thumbResult.data) {
            thumbs[video.path] = thumbResult.data as string
          }
        }
      }

      // 6. 读取季海报 data URL
      let seasonPosterDataUrl = ''
      if (seasonData.poster_path) {
        const pr = await window.api.file
          .readImage(seasonPosterDest)
          .catch(() => ({ success: false, data: null }) as any)
        if (pr.success && pr.data) seasonPosterDataUrl = pr.data as string
      }

      message.destroy()
      message.success(`第 ${sNum} 季刮削完成`)
      return { seasonPosterDataUrl, thumbs }
    } catch (error) {
      message.destroy()
      console.error('季刮削失败:', error)
      message.error(
        `刮削失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
      return empty
    }
  }

  /**
   * 刮削单集：写 episode.nfo + 下载缩略图
   * @param tvShowRoot  剧集根 ProcessedItem（含 tmdbId）
   * @param seasonFolder 季文件夹 ProcessedItem
   * @param videoItem   要刮削的视频文件 ProcessedItem
   * @returns 刮削成功后新的缩略图 data URL（或空字符串）
   */
  const scrapeEpisode = async (
    tvShowRoot: ProcessedItem,
    seasonFolder: ProcessedItem,
    videoItem: ProcessedItem
  ): Promise<string> => {
    const sep = seasonFolder.path.includes('\\') ? '\\' : '/'

    // 1. 读取 tvshow.nfo 拿到 tmdbid
    const nfoPath =
      tvShowRoot.path +
      (tvShowRoot.path.includes('\\') ? '\\' : '/') +
      'tvshow.nfo'
    const nfoContent = await cachedReadText(nfoPath).catch(() => '')
    const tmdbIdMatch = nfoContent.match(/<tmdbid>(\d+)<\/tmdbid>/i)
    if (!tmdbIdMatch) {
      message.error('未找到 TMDB ID，请先刮削整部剧集')
      return ''
    }
    const tmdbId = parseInt(tmdbIdMatch[1])
    const sNum = seasonFolder.seasonNumber ?? 1
    const epNum = videoItem.episodeNumber ?? 0

    if (!epNum) {
      message.error('无法识别集号，请检查文件名')
      return ''
    }

    message.loading(
      `正在刮削 S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}...`,
      0
    )
    try {
      // 2. 拉取剧集详情（用于 NFO 里的 showtitle / credits）
      const tvDetails = await getTVDetails(tmdbId)
      if (!tvDetails) throw new Error('无法获取剧集详情')

      // 3. 拉取季详情，找到对应集数据
      const seasonData = await getSeasonDetails(tmdbId, sNum)
      const epData: EpisodeInfo | undefined = seasonData?.episodes?.find(
        (e: EpisodeInfo) => e.episode_number === epNum
      )
      if (!epData) throw new Error(`TMDB 未找到 S${sNum}E${epNum} 的集数据`)

      // 4. 构造标准基本名（与完整刮削保持一致）
      const showName = sanitizeFilename(
        tvDetails.name || tvDetails.original_name || ''
      )
      const epName = sanitizeFilename(epData.name || '')
      const sTag = `S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
      const newBaseName = epName
        ? `${showName}-${sTag}-${epName}`
        : `${showName}-${sTag}`

      // 5. 重命名视频文件（如有必要）
      const ext = await window.api.path.extname(videoItem.name)
      const newVideoName = `${newBaseName}${ext}`
      if (videoItem.name !== newVideoName) {
        const newVideoPath = await window.api.path.join(
          seasonFolder.path,
          newVideoName
        )
        const moveResult = await window.api.file.move(
          videoItem.path,
          newVideoPath
        )
        if (moveResult.success) {
          videoItem.name = newVideoName
          videoItem.path = newVideoPath
        }
      }

      // 6. 写 episode NFO
      const epNfo = generateEpisodeNFO(tvDetails, sNum, epData)
      await writeTextFile(
        await window.api.path.join(seasonFolder.path, `${newBaseName}.nfo`),
        epNfo
      )

      // 7. 下载缩略图
      const thumbPath = seasonFolder.path + sep + `${newBaseName}-thumb.jpg`
      if (epData.still_path) {
        await downloadImage(`${TMDB_IMG_URL}${epData.still_path}`, thumbPath)
      }

      // 8. 清除该季缩略图缓存，读取新缩略图
      message.destroy()
      message.success(
        `S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')} 刮削完成`
      )

      // 返回新缩略图 data URL（key 是视频 path，可能已重命名，用新路径）
      if (epData.still_path) {
        const thumbResult = await window.api.file
          .readImage(thumbPath)
          .catch(() => ({ success: false, data: null }) as any)
        if (thumbResult.success && thumbResult.data)
          return thumbResult.data as string
      }
      return ''
    } catch (error) {
      message.destroy()
      console.error('单集刮削失败:', error)
      message.error(
        `刮削失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
      return ''
    }
  }

  return {
    currentScrapeItem,
    searchTVInfo,
    getTVDetails,
    getSeasonDetails,
    getAllSeasons,
    convertToTVShowInfo,
    generateTVShowNFO,
    generateSeasonNFO,
    generateEpisodeNFO,
    scrapeTVShow,
    scrapeSeason,
    scrapeEpisode,
    loadLocalTVInfo,
    loadEpisodeThumbs,
    preloadShowImages,
  }
}
