import { TMDB_IMG_URL, tmdb } from '@/api/tmdb'
import { message } from 'ant-design-vue'
import { ref } from 'vue'
import { ProcessedItem, TVShowInfoType, SeasonInfo, EpisodeInfo } from '@/types'

/** 模块级图片缓存：path → dataUrl，避免重复 IPC readImage */
const imageCache = new Map<string, string>()

/** 模块级 NFO 内容缓存：path → content，避免重复文件读取 */
const nfoContentCache = new Map<string, string>()

/** 模块级解析结果缓存：path → TVShowInfo，避免重复 XML 解析 */
const tvInfoCache = new Map<string, TVShowInfoType>()

/** 模块级解析结果缓存：path → SeasonInfo[]，避免重复 XML 解析 */
const seasonsCache = new Map<string, SeasonInfo[]>()

/** 模块级季海报缓存：showPath → { seasonPath: posterUrl }，避免重复查找 */
const seasonPostersCache = new Map<string, Record<string, string>>()

/** 带缓存的 readImage */
const cachedReadImage = async (filePath: string): Promise<string> => {
  const cached = imageCache.get(filePath)
  if (cached) return cached
  const result = await window.api.file.readImage(filePath)
  if (result.success && result.data) {
    const dataUrl = result.data as string
    imageCache.set(filePath, dataUrl)
    return dataUrl
  }
  return ''
}

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
      const englishPart = cleanName.replace(/[\u4e00-\u9fa5]/g, '').replace(/\s+/g, ' ').trim()

      console.log('搜索名称分离:', { cleanName, chinesePart, englishPart })

      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}(?!\w)\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined

      // 显示加载提示
      const loadingMessage = message.loading('正在搜索电视剧信息...', 0)

      try {
        let res: any = { results: [] }

        // 1. 优先用中文搜索
        if (chinesePart) {
          res = await tmdb.search.tv({
            query: chinesePart,
            language: 'zh-CN',
            ...(year && { first_air_date_year: year }),
          })
          console.log('中文搜索结果数量:', res.results.length)
        }

        // 2. 如果中文搜索无结果，用英文搜索
        if (res.results.length === 0 && englishPart) {
          res = await tmdb.search.tv({
            query: englishPart,
            language: 'en-US',
            ...(year && { first_air_date_year: year }),
          })
          console.log('英文搜索结果数量:', res.results.length)
        }

        // 3. 如果还是无结果，用完整名称搜索
        if (res.results.length === 0) {
          res = await tmdb.search.tv({
            query: cleanName,
            language: 'zh-CN',
          })
          console.log('完整名称中文搜索结果数量:', res.results.length)
        }

        // 4. 最后尝试英文完整名称
        if (res.results.length === 0) {
          res = await tmdb.search.tv({
            query: cleanName,
            language: 'en-US',
          })
          console.log('完整名称英文搜索结果数量:', res.results.length)
        }

        loadingMessage()

        if (res.results.length === 0) {
          message.warning('未找到匹配的电视剧')
          return []
        }

        console.log('电视剧搜索结果:', res.results)
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
      
      const tvDetails = await tmdb.tvShows.details(tvId, ['credits'], 'zh-CN')

      loadingMessage()
      console.log('电视剧详细信息:', tvDetails)
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
  const getSeasonDetails = async (tvId: number, seasonNumber: number): Promise<SeasonInfo | null> => {
    try {
      const loadingMessage = message.loading(`正在获取第${seasonNumber}季详细信息...`, 0)
      
      const seasonDetails = await tmdb.tvSeasons.details(
        { tvShowID: tvId, seasonNumber },
        undefined,
        { language: 'zh-CN' }
      )

      loadingMessage()
      console.log('季详细信息:', seasonDetails)
      
      // 转换为SeasonInfo格式
      const seasonInfo: SeasonInfo = {
        season_number: seasonDetails.season_number,
        name: seasonDetails.name,
        episode_count: seasonDetails.episodes?.length,
        air_date: seasonDetails.air_date,
        overview: seasonDetails.overview,
        poster_path: seasonDetails.poster_path ?? undefined,
        episodes: seasonDetails.episodes?.map(ep => ({
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
      message.error('获取季详细信息失败')
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
      const tvDetails = await tmdb.tvShows.details(tvId, undefined, 'zh-CN')

      if (!tvDetails.seasons) {
        return []
      }

      const seasons: SeasonInfo[] = []
      
      for (const season of tvDetails.seasons) {
        if (season.season_number > 0) { // 跳过Specials季
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
      year: tvData.first_air_date ? tvData.first_air_date.substring(0, 4) : undefined,
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
    const studios = tvData.production_companies?.map(c => c.name).join(' / ') || ''
    const countries = tvData.production_countries?.map(c => c.name).join(' / ') || ''

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
    ${tvData.credits?.cast?.slice(0, 10).map(a => `
    <actor>
      <name>${escapeXml(a.name)}</name>
      <role>${escapeXml(a.character || '')}</role>
      <thumb>${a.profile_path ? TMDB_IMG_URL + a.profile_path : ''}</thumb>
    </actor>`).join('') || ''}
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
  const generateEpisodeNFO = (tvData: any, seasonNumber: number, episodeInfo: EpisodeInfo): string => {
    const creators = tvData.created_by?.map(c => c.name).join(' / ') || ''
    const genres = tvData.genres?.map(g => g.name).join(' / ') || ''
    const studios = tvData.production_companies?.map(c => c.name).join(' / ') || ''

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
    ${tvData.credits?.cast?.slice(0, 10).map(a => `
    <actor>
      <name>${escapeXml(a.name)}</name>
      <role>${escapeXml(a.character || '')}</role>
      <thumb>${a.profile_path ? TMDB_IMG_URL + a.profile_path : ''}</thumb>
    </actor>`).join('') || ''}
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
  const downloadImage = async (url: string, destPath: string): Promise<void> => {
    const result = await window.api.http.download(url, destPath)
    if (!result.success) {
      console.warn(`下载图片失败 [${destPath}]:`, result.error)
    }
  }

  /**
   * 写文本文件
   */
  const writeTextFile = async (filePath: string, content: string): Promise<void> => {
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
      await writeTextFile(await window.api.path.join(showPath, 'tvshow.nfo'), nfoContent)

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
        console.log('没有季文件夹，自动组织文件')
        
        // 递归读取目录
        const readDirectoryRecursive = async (dirPath: string): Promise<any[]> => {
          const allFiles: any[] = []
          try {
            const result = await window.api.file.readdir(dirPath)
            if (!result.success || !result.data) {
              return allFiles
            }

            const items = result.data as Array<{ name: string; isDirectory: boolean; isFile: boolean }>
            
            for (const item of items) {
              const fullPath = await window.api.path.join(dirPath, item.name)
              const statResult = await window.api.file.stat(fullPath)
              
              if (!statResult.success || !statResult.data) {
                continue
              }

              const stat = statResult.data as { size: number; isDirectory: boolean; isFile: boolean }
              
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
                } catch (subError) {
                  console.warn(`跳过无法读取的目录: ${fullPath}`, subError)
                }
              }
            }
          } catch (error) {
            console.warn(`读取目录失败，跳过: ${dirPath}`, error)
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
          const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']
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
          const seasonFolderPath = await window.api.path.join(showPath, seasonFolderName)
          
          const existsCheck = await window.api.file.exists(seasonFolderPath)
          if (!existsCheck.success || !existsCheck.exists) {
            const mkdirResult = await window.api.file.mkdir(seasonFolderPath)
            if (mkdirResult.success) {
              console.log(`创建季文件夹: ${seasonFolderName}`)
            }
          }
          
          // 移动文件到季文件夹
          for (const file of seasonFiles) {
            const newPath = await window.api.path.join(seasonFolderPath, file.name)
            const moveResult = await window.api.file.move(file.path, newPath)
            if (moveResult.success) {
              console.log(`移动文件: ${file.name} -> ${seasonFolderName}`)
              
              // 同时移动关联的缩略图文件
              const baseName = file.name.replace(/\.[^.]+$/, '')
              const thumbName = `${baseName}-thumb.jpg`
              const thumbPath = await window.api.path.join(showPath, thumbName)
              const thumbExists = await window.api.file.exists(thumbPath)
              if (thumbExists.success && thumbExists.exists) {
                const newThumbPath = await window.api.path.join(seasonFolderPath, thumbName)
                const thumbMoveResult = await window.api.file.move(thumbPath, newThumbPath)
                if (thumbMoveResult.success) {
                  console.log(`移动缩略图: ${thumbName} -> ${seasonFolderName}`)
                }
              }
            }
          }
        }
        
        // 根据 TMDB 季信息创建缺失的季文件夹
        for (const season of seasons) {
          const seasonFolderName = `Season ${season.season_number}`
          const seasonFolderPath = await window.api.path.join(showPath, seasonFolderName)
          
          const existsCheck = await window.api.file.exists(seasonFolderPath)
          if (!existsCheck.success || !existsCheck.exists) {
            const mkdirResult = await window.api.file.mkdir(seasonFolderPath)
            if (mkdirResult.success) {
              console.log(`创建季文件夹: ${seasonFolderName}`)
            }
          }
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
          
          const parentPath = file.path.substring(0, file.path.lastIndexOf(file.path.includes('\\') ? '\\' : '/'))
          if (parentPath !== showPath) continue // 只处理直接子项
          
          if (file.isDirectory && isTVSeasonFolder(file.name)) {
            // 季文件夹
            newChildren.push({
              name: file.name,
              path: file.path,
              type: 'folder',
              isSeasonFolder: true,
              seasonNumber: extractSeasonNumber(file.name),
              children: [] // 稍后填充
            })
          } else if (file.isFile) {
            // 视频文件
            newChildren.push({
              name: file.name,
              path: file.path,
              type: 'video',
              episodeNumber: extractEpisodeNumber(file.name)
            })
          }
        }
        
        // 为每个季文件夹填充子文件
        for (const seasonChild of newChildren.filter(c => c.isSeasonFolder)) {
          for (const file of updatedFiles) {
            const parentPath = file.path.substring(0, file.path.lastIndexOf(file.path.includes('\\') ? '\\' : '/'))
            if (parentPath === seasonChild.path && file.isFile) {
              seasonChild.children.push({
                name: file.name,
                path: file.path,
                type: 'video',
                episodeNumber: extractEpisodeNumber(file.name)
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
          const seasonNfoPath = await window.api.path.join(seasonFolder.path, 'season.nfo')
          
          // 确保季文件夹存在
          const seasonExists = await window.api.file.exists(seasonFolder.path)
          if (!seasonExists.success || !seasonExists.exists) {
            console.warn(`季文件夹不存在，跳过写入: ${seasonFolder.path}`)
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
          const videoFiles = (seasonFolder.children || []).filter(c => c.type === 'video')
          const showName = sanitizeFilename(tvDetails.name || tvDetails.original_name || '')

          for (const video of videoFiles) {
            const epNum = video.episodeNumber ?? 0
            const epData = episodeDetails.find(e => e.episode_number === epNum)
            if (!epData) continue

            // 构造标准基本名: 剧名-S01E01-集名
            const epName = sanitizeFilename(epData.name || '')
            const sTag = `S${String(sNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
            const newBaseName = epName ? `${showName}-${sTag}-${epName}` : `${showName}-${sTag}`

            // ── 重命名视频文件 ──
            const ext = await window.api.path.extname(video.name)
            const newVideoName = `${newBaseName}${ext}`
            if (video.name !== newVideoName) {
              const newVideoPath = await window.api.path.join(seasonFolder.path, newVideoName)
              const moveResult = await window.api.file.move(video.path, newVideoPath)
              if (moveResult.success) {
                // 同步更新 ProcessedItem（内存中），后续 loadLocalTVInfo 才能找到对应文件
                video.name = newVideoName
                video.path = newVideoPath
              } else {
                console.warn(`重命名视频失败 [${video.name}]:`, moveResult.error)
              }
            }

            // ── 集 NFO ──
            const epNfo = generateEpisodeNFO(tvDetails, sNum, epData)
            await writeTextFile(
              await window.api.path.join(seasonFolder.path, `${newBaseName}.nfo`),
              epNfo
            )

            // ── 集缩略图 ──
            if (epData.still_path) {
              await downloadImage(
                `${TMDB_IMG_URL}${epData.still_path}`,
                await window.api.path.join(seasonFolder.path, `${newBaseName}-thumb.jpg`)
              )
            }
          }
        }
      }

      // 重命名剧集文件夹为 "剧名(年份)" 格式（在所有文件操作完成后）
      const showName = sanitizeFilename(tvDetails.name || tvDetails.original_name || '')
      const year = tvDetails.first_air_date ? tvDetails.first_air_date.substring(0, 4) : ''
      const newFolderName = year ? `${showName}(${year})` : showName
      const currentFolderName = await window.api.path.basename(showPath)
      
      console.log('文件夹重命名调试:', {
        showName,
        year,
        newFolderName,
        currentFolderName,
        shouldRename: currentFolderName !== newFolderName
      })
      
      if (currentFolderName !== newFolderName) {
        const parentPath = await window.api.path.dirname(showPath)
        const newShowPath = await window.api.path.join(parentPath, newFolderName)
        console.log('准备重命名:', { showPath, newShowPath })
        const renameResult = await window.api.file.move(showPath, newShowPath)
        console.log('重命名结果:', renameResult)
        if (renameResult.success) {
          console.log(`重命名剧集文件夹成功: ${currentFolderName} -> ${newFolderName}`)
          // 更新 item.path
          item.path = newShowPath
          item.name = newFolderName
        } else {
          console.warn(`重命名剧集文件夹失败: ${renameResult.error}`)
        }
      } else {
        console.log('文件夹名称已是目标格式，无需重命名')
      }

      message.destroy()
      message.success('电视剧刮削完成！')
    } catch (error) {
      message.destroy()
      console.error('刮削失败:', error)
      message.error(`刮削失败: ${error instanceof Error ? error.message : '未知错误'}`)
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
      const matches = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gi')) || []
      return matches.map(m => m.replace(new RegExp(`</?${tag}>`, 'gi'), '').trim()).filter(Boolean)
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
  ): Promise<{ tvInfo: TVShowInfoType | null; posterDataUrl: string; fanartDataUrl: string; seasonPosters: Record<string, string> }> => {
    const result: { tvInfo: TVShowInfoType | null; posterDataUrl: string; fanartDataUrl: string; seasonPosters: Record<string, string> } = {
      tvInfo: null,
      posterDataUrl: '',
      fanartDataUrl: '',
      seasonPosters: {},
    }

    // 检查是否所有数据都已缓存（秒开路径）
    const cachedTvInfo = tvInfoCache.get(item.path)
    const cachedSeasons = seasonsCache.get(item.path)
    const cachedSeasonPosters = seasonPostersCache.get(item.path)
    const posterPath = await window.api.path.join(item.path, 'poster.jpg')
    const fanartPath = await window.api.path.join(item.path, 'fanart.jpg')
    const cachedPoster = imageCache.get(posterPath)
    const cachedFanart = imageCache.get(fanartPath)

    // 如果所有数据都在缓存中，直接返回（秒开）
    if (cachedTvInfo && cachedSeasons && cachedPoster && cachedFanart && cachedSeasonPosters) {
      result.tvInfo = cachedTvInfo
      result.posterDataUrl = cachedPoster
      result.fanartDataUrl = cachedFanart
      result.tvInfo.seasons = cachedSeasons.sort((a, b) => a.season_number - b.season_number)
      result.seasonPosters = cachedSeasonPosters
      return result
    }

    // 缓存未命中，需要读取
    const nfoPath = await window.api.path.join(item.path, 'tvshow.nfo')

    const [nfoCheck, posterCheck, fanartCheck] = await Promise.all([
      window.api.file.exists(nfoPath),
      window.api.file.exists(posterPath),
      window.api.file.exists(fanartPath),
    ])

    const readTasks: Promise<void>[] = []

    if (cachedTvInfo) {
      result.tvInfo = cachedTvInfo
    } else if (nfoCheck.success && nfoCheck.exists) {
      readTasks.push(
        cachedReadText(nfoPath).then(content => {
          if (content) {
            const parsed = parseTVShowNFO(content)
            result.tvInfo = parsed
            tvInfoCache.set(item.path, parsed)
          }
        }).catch(() => {})
      )
    }

    if (cachedPoster) {
      result.posterDataUrl = cachedPoster
    } else if (posterCheck.success && posterCheck.exists) {
      readTasks.push(
        cachedReadImage(posterPath).then(url => { result.posterDataUrl = url }).catch(() => {})
      )
    }

    if (cachedFanart) {
      result.fanartDataUrl = cachedFanart
    } else if (fanartCheck.success && fanartCheck.exists) {
      readTasks.push(
        cachedReadImage(fanartPath).then(url => { result.fanartDataUrl = url }).catch(() => {})
      )
    }

    await Promise.all(readTasks)

    // 并行加载各季 NFO + 海报
    const seasonFolders = (item.children || []).filter(c => c.isSeasonFolder && c.seasonNumber !== undefined)
    const seasonsKey = item.path
    let parsedSeasons: SeasonInfo[] = []

    if (cachedSeasons) {
      parsedSeasons = cachedSeasons
      if (cachedSeasonPosters) {
        result.seasonPosters = cachedSeasonPosters
      }
    } else {
      await Promise.all(seasonFolders.map(async sf => {
        const [nfoP, posterP] = await Promise.all([
          window.api.path.join(sf.path, 'season.nfo'),
          window.api.path.join(sf.path, `season${String(sf.seasonNumber).padStart(2, '0')}-poster.jpg`),
        ])

        const [nfoC, posterC] = await Promise.all([
          window.api.file.exists(nfoP),
          window.api.file.exists(posterP),
        ])

        const tasks: Promise<void>[] = []
        if (nfoC.success && nfoC.exists) {
          tasks.push(
            cachedReadText(nfoP).then(content => {
              if (content) parsedSeasons.push(parseSeasonNFO(content))
            }).catch(() => {})
          )
        }
        if (posterC.success && posterC.exists) {
          tasks.push(
            cachedReadImage(posterP).then(url => { if (url) result.seasonPosters[sf.path] = url }).catch(() => {})
          )
        }
        await Promise.all(tasks)
      }))

      if (parsedSeasons.length > 0) {
        seasonsCache.set(seasonsKey, parsedSeasons)
      }
      if (Object.keys(result.seasonPosters).length > 0) {
        seasonPostersCache.set(seasonsKey, result.seasonPosters)
      }
    }

    if (result.tvInfo && parsedSeasons.length > 0) {
      result.tvInfo.seasons = parsedSeasons.sort((a, b) => a.season_number - b.season_number)
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

    await Promise.all(videos.map(async v => {
      try {
        const baseName = v.name.replace(/\.[^.]+$/, '')
        const thumbPath = await window.api.path.join(seasonFolder.path, `${baseName}-thumb.jpg`)
        const url = await cachedReadImage(thumbPath)
        if (url) thumbs[v.path] = url
      } catch (_) {}
    }))

    return thumbs
  }

  /**
   * 预加载剧集的 poster、fanart、NFO 和所有季数据（仅填充缓存，不返回数据）
   * 用于 hover 时预加载，实现无卡顿切换
   */
  const preloadShowImages = async (item: ProcessedItem): Promise<void> => {
    console.log('[preloadShowImages] Starting preload for:', item.name)
    const startTime = Date.now()

    const [nfoPath, posterPath, fanartPath] = await Promise.all([
      window.api.path.join(item.path, 'tvshow.nfo'),
      window.api.path.join(item.path, 'poster.jpg'),
      window.api.path.join(item.path, 'fanart.jpg'),
    ])

    const [nfoCheck, posterCheck, fanartCheck] = await Promise.all([
      window.api.file.exists(nfoPath),
      window.api.file.exists(posterPath),
      window.api.file.exists(fanartPath),
    ])

    const tasks: Promise<void>[] = []
    if (nfoCheck.success && nfoCheck.exists) {
      tasks.push(cachedReadText(nfoPath).then(content => {
        if (content) {
          const parsed = parseTVShowNFO(content)
          tvInfoCache.set(item.path, parsed)
          console.log('[preloadShowImages] Cached TV info for:', item.name)
        }
      }).catch(() => {}))
    }
    if (posterCheck.success && posterCheck.exists) {
      tasks.push(cachedReadImage(posterPath).then(() => {}).catch(() => {}))
    }
    if (fanartCheck.success && fanartCheck.exists) {
      tasks.push(cachedReadImage(fanartPath).then(() => {}).catch(() => {}))
    }

    // 预加载所有季 NFO 和海报
    const seasonFolders = (item.children || []).filter(c => c.isSeasonFolder && c.seasonNumber !== undefined)
    const seasonsKey = item.path

    // 如果季数据已缓存，跳过
    if (!seasonsCache.has(seasonsKey)) {
      const seasonTasks: Promise<void>[] = []
      const loadedSeasonPosters: Record<string, string> = {}
      const loadedSeasonNFOs: SeasonInfo[] = []

      for (const sf of seasonFolders) {
        const [nfoP, posterP] = await Promise.all([
          window.api.path.join(sf.path, 'season.nfo'),
          window.api.path.join(sf.path, `season${String(sf.seasonNumber).padStart(2, '0')}-poster.jpg`),
        ])

        const [nfoC, posterC] = await Promise.all([
          window.api.file.exists(nfoP),
          window.api.file.exists(posterP),
        ])

        if (nfoC.success && nfoC.exists) {
          seasonTasks.push(
            cachedReadText(nfoP).then(content => {
              if (content) loadedSeasonNFOs.push(parseSeasonNFO(content))
            }).catch(() => {})
          )
        }
        if (posterC.success && posterC.exists) {
          seasonTasks.push(
            cachedReadImage(posterP).then(url => {
              if (url) loadedSeasonPosters[sf.path] = url
            }).catch(() => {})
          )
        }
      }

      tasks.push(
        Promise.all(seasonTasks).then(() => {
          if (loadedSeasonNFOs.length > 0) {
            seasonsCache.set(seasonsKey, loadedSeasonNFOs)
          }
          if (Object.keys(loadedSeasonPosters).length > 0) {
            seasonPostersCache.set(seasonsKey, loadedSeasonPosters)
          }
          console.log('[preloadShowImages] Cached', loadedSeasonNFOs.length, 'seasons for:', item.name)
        }).catch(() => {})
      )
    } else {
      console.log('[preloadShowImages] Seasons already cached for:', item.name)
    }

    await Promise.all(tasks)
    console.log('[preloadShowImages] Completed preload for:', item.name, 'in', Date.now() - startTime, 'ms')
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
      // 把点和下划线替换为空格（场景发布组常用）
      .replace(/[._]/g, ' ')
      // 移除括号内容 [] () 【】（）
      .replace(/\s*[\[\(【（].*?[\]\)】）]\s*/g, ' ')
      // 移除季集标记
      .replace(/\bS\d+E\d+\b/gi, '')
      .replace(/\bSeason\s*\d+\b/gi, '')
      .replace(/\bEP?\s*\d+\b/gi, '')
      .replace(/第\s*\d+\s*[季集]/g, '')
      .replace(/\b\d+x\d+\b/gi, '')
      // 移除年份（单独的19xx或20xx，但不移除19xxs或20xxs这样的年代）
      .replace(/\b(19|20)\d{2}(?!\w)\b/g, '')
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
    loadLocalTVInfo,
    loadEpisodeThumbs,
    preloadShowImages,
  }
}
