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
    console.log('=== 开始搜索电影信�?===')
    console.log('输入项目:', item)
    try {
      // 设置当前刮削项目
      currentScrapeItem.value = item
      console.log('设置当前刮削项目:', item.name)

      // 检查是否已有本�?NFO 文件
      if (item.hasNfo && item.files) {
        console.log('检测到已有 NFO 文件，优先使用本地信�?)

        const nfoFile = item.files.find(file => file.name.toLowerCase().endsWith('.nfo'))
        if (nfoFile) {
          console.log('读取 NFO 文件:', nfoFile.path)
          const readResult = await window.api.file.read(nfoFile.path)

          if (readResult.success && readResult.data) {
            console.log('NFO 文件内容读取成功')
            const nfoContent = readResult.data as string
            const nfoMovieInfo = parseNfoContent(nfoContent)
            console.log('NFO 解析结果:', nfoMovieInfo)

            // �?NFO 信息转换�?Movie 格式
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

            console.log('�?NFO 生成的电影数�?', movieFromNfo)
            message.success('已从本地 NFO 加载电影信息')
            return [movieFromNfo]
          }
        }
      }

      let searchName = ''

      // 根据item类型提取搜索关键�?      if (item.type === 'folder') {
        // 对于文件夹，使用文件夹名�?        searchName = item.name
        console.log('项目类型为文件夹，使用文件夹名称')
      } else {
        // 对于视频文件，使用文件名（不包含扩展名）
        searchName = item.name.replace(/\.[^.]*$/, '')
        console.log('项目类型为视频文件，提取文件名（不含扩展名）')
      }

      console.log('自动刮削项目:', item.name, '类型:', item.type)
      console.log('原始搜索名称:', searchName)

      // 清理搜索名称
      console.log('开始清理搜索名�?..')
      const cleanName = handleSearchParams(searchName)
      console.log('清理后名�?', cleanName)

      if (!cleanName) {
        console.error('清理后的名称为空')
        message.error('无法解析电影名称')
        return []
      }

      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined
      const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

      console.log('提取的年�?', year)
      console.log('无年份名�?', nameWithoutYear)

      // 显示加载提示
      const loadingMessage = message.loading('正在搜索电影信息...', 0)
      console.log('显示加载提示')

      try {
        // 首次搜索：使用清理后的完整名称和年份
        console.log('=== 首次搜索 ===')
        console.log('搜索参数:', {
          query: nameWithoutYear || cleanName,
          language: 'zh-CN',
          year,
        })
        let res = await tmdb.search.movies({
          query: nameWithoutYear || cleanName,
          language: 'zh-CN',
          ...(year && { year }),
        })
        console.log('首次搜索结果数量:', res.results.length)

        // 只有在没有结果时才进行后续搜�?        if (res.results.length === 0) {
          console.log('首次搜索无结果，尝试后续搜索策略')

          // 如果有年份，尝试不使用年份搜�?          if (year) {
            console.log('=== 尝试无年份搜�?===')
            console.log('搜索参数:', {
              query: nameWithoutYear,
              language: 'zh-CN',
            })
            res = await tmdb.search.movies({
              query: nameWithoutYear,
              language: 'zh-CN',
            })
            console.log('无年份搜索结果数�?', res.results.length)
          }

          // 如果还是没有结果，尝试英文搜�?          if (res.results.length === 0) {
            console.log('=== 尝试英文搜索 ===')
            console.log('搜索参数:', {
              query: nameWithoutYear || cleanName,
              language: 'en-US',
              year,
            })
            res = await tmdb.search.movies({
              query: nameWithoutYear || cleanName,
              language: 'en-US',
              ...(year && { year }),
            })
            console.log('英文搜索结果数量:', res.results.length)
          }
        }

        loadingMessage()
        console.log('隐藏加载提示')

        if (res.results.length === 0) {
          console.error('所有搜索策略均无结�?)
          message.error('未找到该电影')
          return []
        }

        // 处理搜索结果
        console.log('=== 处理搜索结果 ===')
        console.log('原始结果数量:', res.results.length)
        const movies = res.results.map((movie: Movie) => ({
          ...movie,
          poster_path: movie.poster_path
            ? TMDB_IMG_URL + movie.poster_path
            : '',
          id: movie.id as number,
        })) as Movie[]
        console.log('处理后的电影列表:', movies.map(m => ({ title: m.title, id: m.id })))

        // 返回搜索结果，让主页面处理显示弹�?        console.log('=== 搜索完成 ===')
        return movies
      } catch (searchError) {
        loadingMessage()
        console.error('搜索电影时出�?', searchError)
        message.error('搜索电影时出�?)
        return []
      }
    } catch (error) {
      console.error('自动刮削时出�?', error)
      message.error('自动刮削时出�?)
      return []
    }
  }

  /**
   * 清理文件夹中的旧电影相关文件（海报、艺术图、NFO文件�?   * @param folderPath 文件夹路�?   */
  const cleanOldMovieFiles = async (folderPath: string): Promise<void> => {
    try {
      console.log('=== 开始清理旧文件 ===')
      console.log('文件夹路�?', folderPath)

      // 获取文件夹中的所有文�?      const folderFiles = (await window.api.file.readdir(folderPath)) as {
        data: Array<{
          name: string
          isDirectory: boolean
          isFile: boolean
        }>
      }

      console.log('读取文件夹结�?', folderFiles)

      const files = folderFiles.data as Array<{
        name: string
        isDirectory: boolean
        isFile: boolean
      }>

      console.log('文件夹中的文件数�?', files.length)
      console.log('文件列表:', files.map(f => f.name))

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
            // 艺术图文�?            fileName.includes('fanart') ||
            fileName.includes('backdrop') ||
            // 常见的图片文件（但排除视频缩略图�?            ((fileName.endsWith('.jpg') ||
              fileName.endsWith('.jpeg') ||
              fileName.endsWith('.png') ||
              fileName.endsWith('.webp')) &&
              !fileName.includes('thumb'))

          if (shouldDelete) {
            const filePath = await window.api.path.join(folderPath, file.name)
            filesToDelete.push(filePath)
            console.log(`标记删除文件: ${file.name}`)
          }
        }
      }

      console.log(`找到 ${filesToDelete.length} 个需要删除的文件`)

      // 删除旧文�?      for (const filePath of filesToDelete) {
        try {
          const deleteResult = await window.api.file.delete(filePath)

          if (deleteResult.success) {
            console.log(
              `已删除旧文件: ${await window.api.path.basename(filePath)}`
            )
          } else {
            console.warn(
              `删除文件失败: ${filePath}, 错误: ${deleteResult.error}`
            )
          }
        } catch (error) {
          console.warn(`删除文件时出�? ${filePath}`, error)
        }
      }

      if (filesToDelete.length > 0) {
        console.log(`已清�?${filesToDelete.length} 个旧文件`)
      } else {
        console.log('没有需要清理的旧文�?)
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
    console.log('=== 开始清理搜索参�?===')
    console.log('原始电影名称:', movieName)
    let cleanName = movieName

    // 1. 移除文件扩展�?    console.log('步骤1: 移除文件扩展�?)
    cleanName = cleanName.replace(/\.[^.]*$/, '')
    console.log('移除扩展名后:', cleanName)

    // 2. 移除常见的视频质量标�?    console.log('步骤2: 移除视频质量标识')
    const qualityPatterns = [
      /\b(4K|2160p|1080p|720p|480p|360p)\b/gi,
      /\b(UHD|HD|SD|CAM|TS|TC|SCR|R5|DVDRip|BRRip|BluRay|WEBRip|HDTV)\b/gi,
      /\b(x264|x265|H264|H265|HEVC|AVC)\b/gi,
      /\b(AAC|AC3|DTS|MP3|FLAC)\b/gi,
      /\b(5\.1|7\.1|2\.0)\b/gi,
    ]

    qualityPatterns.forEach(pattern => {
      cleanName = cleanName.replace(pattern, ' ')
    })
    console.log('移除质量标识�?', cleanName)

    // 3. 移除发布组信息（通常在方括号或圆括号中）
    console.log('步骤3: 移除发布组信�?)
    cleanName = cleanName.replace(/\[[^\]]*\]/g, ' ')
    cleanName = cleanName.replace(
      /\([^)]*(?:rip|cam|ts|tc|scr|r5|web|hdtv)[^)]*\)/gi,
      ' '
    )
    console.log('移除发布组信息后:', cleanName)

    // 4. 移除常见的分隔符和替换为空格
    console.log('步骤4: 移除分隔�?)
    cleanName = cleanName.replace(/[._-]/g, ' ')
    console.log('移除分隔符后:', cleanName)

    // 5. 移除多余的空�?    console.log('步骤5: 移除多余空格')
    cleanName = cleanName.replace(/\s+/g, ' ').trim()
    console.log('移除多余空格�?', cleanName)

    // 6. 提取年份（保留用于后续处理）
    console.log('步骤6: 提取年份')
    const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? yearMatch[0] : ''
    console.log('提取的年�?', year)

    // 7. 移除年份周围的括�?    console.log('步骤7: 移除年份周围的括�?)
    cleanName = cleanName.replace(/\(\s*(19|20)\d{2}\s*\)/g, ` ${year} `)
    console.log('移除年份括号�?', cleanName)

    // 8. 移除常见的无用词�?    console.log('步骤8: 移除无用词汇')
    const uselessWords = [
      'complete',
      'proper',
      'repack',
      'internal',
      'limited',
      'festival',
      'retail',
      'extended',
      'unrated',
      'directors',
      'cut',
      'edition',
      'version',
      'remastered',
      'criterion',
      'collection',
      'anthology',
      'series',
      'season',
      'episode',
      'disc',
      'cd1',
      'cd2',
      'part1',
      'part2',
      'pt1',
      'pt2',
    ]

    const uselessPattern = new RegExp(`\\b(${uselessWords.join('|')})\\b`, 'gi')

    cleanName = cleanName.replace(uselessPattern, ' ')
    console.log('移除无用词汇�?', cleanName)

    // 9. 移除数字序列（如果不是年份）
    console.log('步骤9: 移除数字序列')
    cleanName = cleanName.replace(/\b\d{3,}(?!\d*\b(19|20)\d{2}\b)\b/g, ' ')
    console.log('移除数字序列�?', cleanName)

    // 10. 移除单独的数字和字母
    console.log('步骤10: 移除单独的数字和字母')
    cleanName = cleanName.replace(/\b[a-zA-Z]\b/g, ' ')
    console.log('移除单独数字字母�?', cleanName)
    cleanName = cleanName.replace(/\b\d{1,2}\b(?!\d)/g, ' ')

    // 11. 再次提取年份（可能在清理过程中位置发生变化）
    console.log('步骤11: 再次提取年份')
    const finalYearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
    const finalYear = finalYearMatch ? finalYearMatch[0] : ''
    console.log('最终提取的年份:', finalYear)

    // 12. 将点号替换为空格（常见于英文电影文件名）
    console.log('步骤12: 替换点号为空�?)
    cleanName = cleanName.replace(/\./g, ' ')
    console.log('替换点号�?', cleanName)

    // 13. 移除特殊字符，保留字母、数字、空格和中文
    console.log('步骤13: 移除特殊字符')
    cleanName = cleanName.replace(/[^a-zA-Z0-9\s\u4e00-\u9fa5]/g, ' ')
    console.log('移除特殊字符�?', cleanName)

    // 14. 清理多余空格
    console.log('步骤14: 清理多余空格')
    cleanName = cleanName.replace(/\s+/g, ' ').trim()
    console.log('清理多余空格�?', cleanName)

    // 15. 如果有年份，确保年份在末�?    if (finalYear) {
      console.log('步骤15: 确保年份在末�?)
      cleanName = cleanName
        .replace(new RegExp(`\\b${finalYear}\\b`, 'g'), '')
        .trim()
      cleanName += ` ${finalYear}`
      console.log('添加年份�?', cleanName)
    }

    console.log('=== 清理搜索参数完成 ===')
    console.log('最终清理结�?', cleanName)
    return cleanName || movieName // 如果清理后为空，返回原始名称
  }

  /**
   * 在指定文件夹中刮削电影信息（下载海报和创建NFO文件�?   * @param movieData 电影数据
   * @param folderPath 文件夹路�?   * @param videoBaseName 视频文件基础名称（不含扩展名�?   */
  const scrapeMovieInFolder = async (
    movieData: Movie,
    folderPath: string,
    videoBaseName: string
  ): Promise<void> => {
    try {
      console.log('=== 开始刮削电影信�?===')
      console.log('电影数据:', movieData)
      console.log('文件夹路�?', folderPath)
      console.log('视频基础名称:', videoBaseName)

      // 检查是否已有资�?      const existingResources = await checkExistingResources(folderPath, videoBaseName)
      console.log('已有资源检查结�?', existingResources)

      // 如果已有 NFO，优先使用其中的信息
      if (existingResources.hasNfo && existingResources.nfoContent) {
        console.log('发现已有 NFO 文件，优先使用其中的信息')
        const nfoMovieInfo = parseNfoContent(existingResources.nfoContent)
        
        // 合并 NFO 中的信息�?movieData
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
        
        console.log('合并后的电影数据:', movieData)
      }

      message.loading('正在清理旧文件并下载电影信息...', 0)

      // const TMDB_IMG_URL = 'https://image.tmdb.org/t/p/w500'

      // 首先清理文件夹中的旧海报、艺术图和NFO文件
      console.log('开始清理旧文件...')
      await cleanOldMovieFiles(folderPath)
      console.log('旧文件清理完�?)

      // 构建文件路径
      const nfoFileName = `${videoBaseName}.nfo`

      const posterFileNames = [
        `${videoBaseName}-poster.jpg`,
        `${videoBaseName}-movie.jpg`,
        `${videoBaseName}-folder.jpg`,
      ]

      const fanartFileNames = [`${videoBaseName}-fanart.jpg`]

      const nfoPath = await window.api.path.join(folderPath, nfoFileName)

      console.log('NFO文件路径:', nfoPath)

      // 创建海报路径
      const posterPaths: { fileName: string; path: string }[] = []

      for (const fileName of posterFileNames) {
        const path = await window.api.path.join(folderPath, fileName)
        posterPaths.push({ fileName, path })
        console.log(`海报文件路径 ${fileName}:`, path)
      }

      // 创建艺术图路�?      const fanartPaths: { fileName: string; path: string }[] = []

      for (const fileName of fanartFileNames) {
        const path = await window.api.path.join(folderPath, fileName)
        fanartPaths.push({ fileName, path })
        console.log(`艺术图文件路�?${fileName}:`, path)
      }

      // 创建NFO文件内容
      console.log('开始生成NFO内容...')
      const nfoContent = createNfoContent(movieData)
      console.log('NFO内容长度:', nfoContent.length)

      // 写入NFO文件
      console.log('开始写入NFO文件...')
      const nfoResult = await window.api.file.write(nfoPath, nfoContent)
      console.log('NFO写入结果:', nfoResult)

      if (!nfoResult.success) {
        throw new Error(`创建NFO文件失败: ${nfoResult.error}`)
      }

      // 验证NFO文件是否真的创建�?      const nfoExists = await window.api.file.exists(nfoPath)
      console.log('NFO文件存在验证:', nfoExists)

      if (!nfoExists.exists) {
        console.error('NFO文件写入成功但文件不存在，可能是权限问题')
        throw new Error('NFO文件写入成功但文件不存在，可能是权限问题')
      }

      // 下载海报（如果不存在�?      if (movieData.poster_path) {
        // 检查是否已有海�?        if (existingResources.hasPoster && existingResources.posterPath) {
          console.log('已有海报文件，跳过下�?', existingResources.posterPath)
        } else {
          const posterUrl = movieData.poster_path.startsWith('http')
            ? movieData.poster_path
            : `${TMDB_IMG_URL}${movieData.poster_path}`

          console.log('海报URL:', posterUrl)

          for (const { fileName, path } of posterPaths) {
            console.log(`开始下载海�?${fileName}...`)
            const posterResult = await window.api.http.download(posterUrl, path)
            console.log(`海报 ${fileName} 下载结果:`, posterResult)

            if (!posterResult.success) {
              console.error(`下载 ${fileName} 失败: ${posterResult.error}`)
            } else {
              // 验证文件是否真的下载�?              const fileExists = await window.api.file.exists(path)
              console.log(`海报文件 ${fileName} 存在验证:`, fileExists)
            }
          }
        }
      } else {
        console.log('电影数据中没有海报路�?)
      }

      // 下载背景图（如果不存在）
      if (movieData.backdrop_path) {
        // 检查是否已有背景图
        if (existingResources.hasFanart && existingResources.fanartPath) {
          console.log('已有背景图文件，跳过下载:', existingResources.fanartPath)
        } else {
          const fanartUrl = `${TMDB_IMG_URL}${movieData.backdrop_path}`
          console.log('背景图URL:', fanartUrl)

          for (const { fileName, path } of fanartPaths) {
            console.log(`开始下载背景图 ${fileName}...`)
            const fanartResult = await window.api.http.download(fanartUrl, path)
            console.log(`背景�?${fileName} 下载结果:`, fanartResult)

            if (!fanartResult.success) {
              console.error(`下载 ${fileName} 失败: ${fanartResult.error}`)
            } else {
              // 验证文件是否真的下载�?              const fileExists = await window.api.file.exists(path)
              console.log(`背景图文�?${fileName} 存在验证:`, fileExists)
            }
          }
        }
      } else {
        console.log('电影数据中没有背景图路径')
      }

      message.destroy()
      message.success('电影信息刮削完成�?)
      console.log('=== 刮削完成 ===')
    } catch (error) {
      message.destroy()
      console.error('刮削电影信息失败:', error)
      message.error(
        `刮削失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  /**
   * 创建NFO文件内容
   * @param movieData 电影数据
   * @returns NFO XML内容
   */
  const createNfoContent = (movieData: Movie): string => {
    console.log('=== 开始生�?NFO 内容 ===')
    console.log('电影标题:', movieData.title)
    console.log('原始标题:', movieData.original_title)
    console.log('发布日期:', movieData.release_date)
    console.log('评分:', movieData.vote_average)
    console.log('海报路径:', movieData.poster_path)
    console.log('背景图路�?', movieData.backdrop_path)
    console.log('完整电影数据:', movieData)

    const releaseYear = movieData.release_date
      ? new Date(movieData.release_date).getFullYear()
      : ''
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
  <tmdbid>${movieData.id || 0}</tmdbid>
