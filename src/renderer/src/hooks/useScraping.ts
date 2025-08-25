import { TMDB_IMG_URL, tmdb } from '../api/tmdb'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { ref } from 'vue'
import { ProcessedItem } from '../types'

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

      let searchName = ''

      // 根据item类型提取搜索关键词
      if (item.type === 'folder') {
        // 对于文件夹，使用文件夹名称
        searchName = item.name
      } else {
        // 对于视频文件，使用文件名（不包含扩展名）
        searchName = item.name.replace(/\.[^.]*$/, '')
      }

      console.log('自动刮削项目:', item.name, '类型:', item.type)
      console.log('原始搜索名称:', searchName)

      // 清理搜索名称
      const cleanName = handleSearchParams(searchName)

      console.log('清理后名称:', cleanName)

      if (!cleanName) {
        message.error('无法解析电影名称')
        return []
      }

      // 提取年份信息
      const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)

      const year = yearMatch ? parseInt(yearMatch[0]) : undefined

      const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

      console.log('提取的年份:', year)
      console.log('无年份名称:', nameWithoutYear)

      // 显示加载提示
      const loadingMessage = message.loading('正在搜索电影信息...', 0)

      try {
        // 首次搜索：使用清理后的完整名称和年份
        let res = await tmdb.search.movies({
          query: nameWithoutYear || cleanName,
          language: 'zh-CN',
          ...(year && { year }),
        })

        // 只有在没有结果时才进行后续搜索
        if (res.results.length === 0) {
          // 如果有年份，尝试不使用年份搜索
          if (year) {
            console.log('尝试无年份搜索:', nameWithoutYear)
            res = await tmdb.search.movies({
              query: nameWithoutYear,
              language: 'zh-CN',
            })
          }

          // 如果还是没有结果，尝试英文搜索
          if (res.results.length === 0) {
            console.log('尝试英文搜索:', nameWithoutYear || cleanName)
            res = await tmdb.search.movies({
              query: nameWithoutYear || cleanName,
              language: 'en-US',
              ...(year && { year }),
            })
          }
        }

        loadingMessage()

        if (res.results.length === 0) {
          message.error('未找到该电影')
          return []
        }

        // 处理搜索结果
        const movies = res.results.map((movie: Movie) => ({
          ...movie,
          poster_path: movie.poster_path
            ? TMDB_IMG_URL + movie.poster_path
            : '',
          id: movie.id as number,
        })) as Movie[]

        // 返回搜索结果，让主页面处理显示弹窗
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
      // 获取文件夹中的所有文件
      const folderFiles = (await window.api.file.readdir(folderPath)) as {
        data: Array<{
          name: string
          isDirectory: boolean
          isFile: boolean
        }>
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

      // 删除旧文件
      for (const filePath of filesToDelete) {
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
          console.warn(`删除文件时出错: ${filePath}`, error)
        }
      }

      if (filesToDelete.length > 0) {
        console.log(`已清理 ${filesToDelete.length} 个旧文件`)
      }
    } catch (error) {
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

    // 1. 移除文件扩展名
    cleanName = cleanName.replace(/\.[^.]*$/, '')

    // 2. 移除常见的视频质量标识
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

    // 3. 移除发布组信息（通常在方括号或圆括号中）
    cleanName = cleanName.replace(/\[[^\]]*\]/g, ' ')
    cleanName = cleanName.replace(
      /\([^)]*(?:rip|cam|ts|tc|scr|r5|web|hdtv)[^)]*\)/gi,
      ' '
    )

    // 4. 移除常见的分隔符和替换为空格
    cleanName = cleanName.replace(/[._-]/g, ' ')

    // 5. 移除多余的空格
    cleanName = cleanName.replace(/\s+/g, ' ').trim()

    // 6. 提取年份（保留用于后续处理）
    const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)

    const year = yearMatch ? yearMatch[0] : ''

    // 7. 移除年份周围的括号
    cleanName = cleanName.replace(/\(\s*(19|20)\d{2}\s*\)/g, ` ${year} `)

    // 8. 移除常见的无用词汇
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

    // 9. 移除数字序列（如果不是年份）
    cleanName = cleanName.replace(/\b\d{3,}(?!\d*\b(19|20)\d{2}\b)\b/g, ' ')

    // 10. 移除单独的数字和字母
    cleanName = cleanName.replace(/\b[a-zA-Z]\b/g, ' ')
    cleanName = cleanName.replace(/\b\d{1,2}\b(?!\d)/g, ' ')

    // 11. 再次提取年份（可能在清理过程中位置发生变化）
    const finalYearMatch = cleanName.match(/\b(19|20)\d{2}\b/)

    const finalYear = finalYearMatch ? finalYearMatch[0] : ''

    // 12. 将点号替换为空格（常见于英文电影文件名）
    cleanName = cleanName.replace(/\./g, ' ')

    // 13. 移除特殊字符，保留字母、数字、空格和中文
    cleanName = cleanName.replace(/[^a-zA-Z0-9\s\u4e00-\u9fa5]/g, ' ')

    // 14. 清理多余空格
    cleanName = cleanName.replace(/\s+/g, ' ').trim()

    // 15. 如果有年份，确保年份在末尾
    if (finalYear) {
      cleanName = cleanName
        .replace(new RegExp(`\\b${finalYear}\\b`, 'g'), '')
        .trim()
      cleanName += ` ${finalYear}`
    }

    return cleanName || movieName // 如果清理后为空，返回原始名称
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
      message.loading('正在清理旧文件并下载电影信息...', 0)

      // const TMDB_IMG_URL = 'https://image.tmdb.org/t/p/w500'

      // 首先清理文件夹中的旧海报、艺术图和NFO文件
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

      // 创建海报路径
      const posterPaths: { fileName: string; path: string }[] = []

      for (const fileName of posterFileNames) {
        const path = await window.api.path.join(folderPath, fileName)

        posterPaths.push({ fileName, path })
      }

      // 创建艺术图路径
      const fanartPaths: { fileName: string; path: string }[] = []

      for (const fileName of fanartFileNames) {
        const path = await window.api.path.join(folderPath, fileName)

        fanartPaths.push({ fileName, path })
      }

      // 创建NFO文件内容
      const nfoContent = createNfoContent(movieData)

      // 写入NFO文件
      const nfoResult = await window.api.file.write(nfoPath, nfoContent)

      if (!nfoResult.success) {
        throw new Error(`创建NFO文件失败: ${nfoResult.error}`)
      }

      // 下载海报
      if (movieData.poster_path) {
        const posterUrl = movieData.poster_path.startsWith('http')
          ? movieData.poster_path
          : `${TMDB_IMG_URL}${movieData.poster_path}`

        for (const { fileName, path } of posterPaths) {
          const posterResult = await window.api.http.download(posterUrl, path)

          if (!posterResult.success) {
            console.error(`下载 ${fileName} 失败: ${posterResult.error}`)
          }
        }
      }

      // 下载背景图
      if (movieData.backdrop_path) {
        const fanartUrl = `${TMDB_IMG_URL}${movieData.backdrop_path}`

        console.log(fanartUrl, 'fanartUrl')

        for (const { fileName, path } of fanartPaths) {
          const fanartResult = await window.api.http.download(fanartUrl, path)

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
   * 创建NFO文件内容
   * @param movieData 电影数据
   * @returns NFO XML内容
   */
  const createNfoContent = (movieData: Movie): string => {
    console.log(movieData)

    const releaseYear = movieData.release_date
      ? new Date(movieData.release_date).getFullYear()
      : ''
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <movie>
  <title>${movieData.title || ''}</title>
  <originaltitle>${movieData.original_title || movieData.title || ''}</originaltitle>
  <sorttitle/>
  <epbookmark/>
  <year>${releaseYear}</year>
  <ratings>
    <rating default="false" max="10" name="themoviedb">
      <value>${movieData.vote_average}</value>
      <votes>${movieData.vote_count}</votes>
    </rating>
  </ratings>
  <userrating>0</userrating>
  <top250>0</top250>
  <set/>
  <plot>“暴食”、“贪婪”、“懒惰”、“嫉妒”、“骄傲”、“淫欲”、“愤怒”，这是天主教教义所指的人性七宗罪。城市中发生的连坏杀人案，死者恰好都是犯有这些教义的人。凶手故弄玄虚的作案手法，令资深冷静的警员沙摩塞（摩根•弗里曼 Morgan Freeman 饰）和血气方刚的新扎警员米尔斯（布拉德•皮特 Brad Pitt 饰）都陷入了破案的谜团中。他们去图书馆研读但丁的《神曲》，企图从人间地狱的描绘中找到线索，最后从宗教文学哲学的世界中找到了凶手作案计划和手段的蛛丝马迹。凶手前来投案自首，这令众人都松了一口气，以为案件就此结束，怎料还是逃不出七宗罪的杀人逻辑，这次凶手瞄准的目标，是那个犯了“愤怒”罪的人……</plot>
  <outline>“暴食”、“贪婪”、“懒惰”、“嫉妒”、“骄傲”、“淫欲”、“愤怒”，这是天主教教义所指的人性七宗罪。城市中发生的连坏杀人案，死者恰好都是犯有这些教义的人。凶手故弄玄虚的作案手法，令资深冷静的警员沙摩塞（摩根•弗里曼 Morgan Freeman 饰）和血气方刚的新扎警员米尔斯（布拉德•皮特 Brad Pitt 饰）都陷入了破案的谜团中。他们去图书馆研读但丁的《神曲》，企图从人间地狱的描绘中找到线索，最后从宗教文学哲学的世界中找到了凶手作案计划和手段的蛛丝马迹。凶手前来投案自首，这令众人都松了一口气，以为案件就此结束，怎料还是逃不出七宗罪的杀人逻辑，这次凶手瞄准的目标，是那个犯了“愤怒”罪的人……</outline>
  <tagline/>
  <runtime>127</runtime>
  <thumb aspect="poster">https://image.tmdb.org/t/p/original/rbAHypiN4AM6TgMqEze7RvHNGG7.jpg</thumb>
  <fanart>
    <thumb>https://image.tmdb.org/t/p/original/e2Q4FbWlI5ULwP5uTApg4pSXRfm.jpg</thumb>
    <thumb>https://image.tmdb.org/t/p/original/mEbyFTKcWsrFqWBKROzq0Uxoqas.jpg</thumb>
    <thumb>https://image.tmdb.org/t/p/original/9caF8YFMOTzOm0N5zwhKUeVoOSY.jpg</thumb>
    <thumb>https://image.tmdb.org/t/p/original/msSmN9nKiUtBvaAn3Qurq6xOUff.jpg</thumb>
    <thumb>https://image.tmdb.org/t/p/original/i5H7zusQGsysGQ8i6P361Vnr0n2.jpg</thumb>
    <thumb>https://image.tmdb.org/t/p/original/xfAi4XOuXSLhQXM7lsgEwO3X17H.jpg</thumb>
  </fanart>
  <mpaa>US:R / US:Rated R</mpaa>
  <certification>US:R / US:Rated R</certification>
  <id>tt0114369</id>
  <tmdbid>807</tmdbid>
  <uniqueid default="false" type="tmdb">807</uniqueid>
  <uniqueid default="true" type="imdb">tt0114369</uniqueid>
  <uniqueid default="false" type="wikidata">Q190908</uniqueid>
  <country>美国</country>
  <status/>
  <code/>
  <premiered>1995-09-22</premiered>
  <watched>false</watched>
  <playcount>0</playcount>
  <genre>Crime</genre>
  <genre>Mystery</genre>
  <genre>Thriller</genre>
  <studio>New Line Cinema</studio>
  <studio>Juno Pix</studio>
  <studio>Arnold Kopelson Productions</studio>
  <credits tmdbid="12047">安德鲁·凯文·沃克</credits>
  <director tmdbid="7467">大卫·芬奇</director>
  <tag>rage and hate</tag>
  <tag>police</tag>
  <tag>s.w.a.t.</tag>
  <tag>sadism</tag>
  <tag>self-fulfilling prophecy</tag>
  <tag>psychopath</tag>
  <tag>detective</tag>
  <tag>investigation</tag>
  <tag>insomnia</tag>
  <tag>murder</tag>
  <tag>serial killer</tag>
  <tag>religion</tag>
  <tag>shootout</tag>
  <tag>corpse</tag>
  <tag>macabre</tag>
  <tag>seven deadly sins</tag>
  <tag>depravity</tag>
  <tag>neo-noir</tag>
  <tag>calm</tag>
  <tag>urban gothic</tag>
  <tag>ambiguous</tag>
  <tag>ominous</tag>
  <tag>seven: los siete pecados capitales</tag>
  <actor>
    <name>摩根·弗里曼</name>
    <role>Somerset</role>
    <thumb>https://image.tmdb.org/t/p/h632/jPsLqiYGSofU4s6BjrxnefMfabb.jpg</thumb>
    <profile>https://www.themoviedb.org/person/192</profile>
    <tmdbid>192</tmdbid>
  </actor>
  <actor>
    <name>布拉德·皮特</name>
    <role>Mills</role>
    <thumb>https://image.tmdb.org/t/p/h632/cckcYc2v0yh1tc9QjRelptcOBko.jpg</thumb>
    <profile>https://www.themoviedb.org/person/287</profile>
    <tmdbid>287</tmdbid>
  </actor>
  <actor>
    <name>格温妮斯·帕特洛</name>
    <role>Tracy</role>
    <thumb>https://image.tmdb.org/t/p/h632/kvk2UXWO45pQWlbErtotK3npHNP.jpg</thumb>
    <profile>https://www.themoviedb.org/person/12052</profile>
    <tmdbid>12052</tmdbid>
  </actor>
  <actor>
    <name>约翰·卡西尼</name>
    <role>Officer Davis</role>
    <thumb>https://image.tmdb.org/t/p/h632/kn2Rtn0I8ivCR7ydZTY74XUBh1K.jpg</thumb>
    <profile>https://www.themoviedb.org/person/12055</profile>
    <tmdbid>12055</tmdbid>
  </actor>
  <actor>
    <name>彼得·克朗比</name>
    <role>Dr. O'Neill</role>
    <thumb>https://image.tmdb.org/t/p/h632/pMvhE1wwQo3eTSp4vwq8Hb22CwN.jpg</thumb>
    <profile>https://www.themoviedb.org/person/30487</profile>
    <tmdbid>30487</tmdbid>
  </actor>
  <actor>
    <name>雷格·E·凯蒂</name>
    <role>Dr. Santiago</role>
    <thumb>https://image.tmdb.org/t/p/h632/cgyJJQUdbK4S7ihkL9hgIIwutk3.jpg</thumb>
    <profile>https://www.themoviedb.org/person/38951</profile>
    <tmdbid>38951</tmdbid>
  </actor>
  <actor>
    <name>罗纳德·李·埃尔梅</name>
    <role>Police Captain</role>
    <thumb>https://image.tmdb.org/t/p/h632/aXFJlEGHlQT7bwxkKwq6Sx7PeEp.jpg</thumb>
    <profile>https://www.themoviedb.org/person/8655</profile>
    <tmdbid>8655</tmdbid>
  </actor>
  <actor>
    <name>丹尼尔·萨卡帕</name>
    <role>Detective Taylor at First Murder</role>
    <thumb>https://image.tmdb.org/t/p/h632/85Ve9cyC2RG3cY20HHv1JrtMqdC.jpg</thumb>
    <profile>https://www.themoviedb.org/person/12054</profile>
    <tmdbid>12054</tmdbid>
  </actor>
  <actor>
    <name>安德鲁·凯文·沃克</name>
    <role>Dead Man at 1st Crime Scene</role>
    <thumb>https://image.tmdb.org/t/p/h632/t7O6bNRscxOYadGNB1EWvBaSC0d.jpg</thumb>
    <profile>https://www.themoviedb.org/person/12047</profile>
    <tmdbid>12047</tmdbid>
  </actor>
  <actor>
    <name>George Christy</name>
    <role>Workman at Door of Somerset's Office</role>
    <thumb>https://image.tmdb.org/t/p/h632/8kmZnMFtItkqASxsRtsSBZbbBBl.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1583695</profile>
    <tmdbid>1583695</tmdbid>
  </actor>
  <actor>
    <name>Endre Hules</name>
    <role>Cab Driver</role>
    <thumb>https://image.tmdb.org/t/p/h632/nIAnouBLmT2kbYA7fs9R8ix9I50.jpg</thumb>
    <profile>https://www.themoviedb.org/person/43461</profile>
    <tmdbid>43461</tmdbid>
  </actor>
  <actor>
    <name>Hawthorne James</name>
    <role>George the Night Guard at the Library</role>
    <thumb>https://image.tmdb.org/t/p/h632/9QvR5gBQkxY7HSFkHegFHxeZXb0.jpg</thumb>
    <profile>https://www.themoviedb.org/person/12056</profile>
    <tmdbid>12056</tmdbid>
  </actor>
  <actor>
    <name>Bob Mack</name>
    <role>Gluttony Victim</role>
    <profile>https://www.themoviedb.org/person/4294859</profile>
    <tmdbid>4294859</tmdbid>
  </actor>
  <actor>
    <name>William Davidson</name>
    <role>First Guard at the Library</role>
    <profile>https://www.themoviedb.org/person/1025337</profile>
    <tmdbid>1025337</tmdbid>
  </actor>
  <actor>
    <name>Bob Collins</name>
    <role>Second Guard at the Library</role>
    <profile>https://www.themoviedb.org/person/1055173</profile>
    <tmdbid>1055173</tmdbid>
  </actor>
  <actor>
    <name>Jimmy Dale Hartsell</name>
    <role>Library Janitor</role>
    <profile>https://www.themoviedb.org/person/4207972</profile>
    <tmdbid>4207972</tmdbid>
  </actor>
  <actor>
    <name>理查德·朗德特里</name>
    <role>Talbot</role>
    <thumb>https://image.tmdb.org/t/p/h632/wPuLgW8PrzJFBrfsB03oon5MT7f.jpg</thumb>
    <profile>https://www.themoviedb.org/person/6487</profile>
    <tmdbid>6487</tmdbid>
  </actor>
  <actor>
    <name>Charline Su</name>
    <role>TV News Reporter</role>
    <profile>https://www.themoviedb.org/person/4294870</profile>
    <tmdbid>4294870</tmdbid>
  </actor>
  <actor>
    <name>Dominique Jennings</name>
    <role>TV News Reporter</role>
    <thumb>https://image.tmdb.org/t/p/h632/gQvFevYR8dyH0TTOnOAV8tOMSEO.jpg</thumb>
    <profile>https://www.themoviedb.org/person/95200</profile>
    <tmdbid>95200</tmdbid>
  </actor>
  <actor>
    <name>Allan Kolman</name>
    <role>First Forensic Man in the Law Office</role>
    <thumb>https://image.tmdb.org/t/p/h632/18Y2IkYm3UZw7QXtS18BjO9LATU.jpg</thumb>
    <profile>https://www.themoviedb.org/person/31533</profile>
    <tmdbid>31533</tmdbid>
  </actor>
  <actor>
    <name>Beverly Burke</name>
    <role>TV Anchor Woman</role>
    <profile>https://www.themoviedb.org/person/4300035</profile>
    <tmdbid>4300035</tmdbid>
  </actor>
  <actor>
    <name>Gene Borkan</name>
    <role>Eli Gould - Greed Victim</role>
    <thumb>https://image.tmdb.org/t/p/h632/b4YJYoLnrq5dZzCWpeUcfTdI03q.jpg</thumb>
    <profile>https://www.themoviedb.org/person/152638</profile>
    <tmdbid>152638</tmdbid>
  </actor>
  <actor>
    <name>Julie Araskog</name>
    <role>Mrs. Gould</role>
    <thumb>https://image.tmdb.org/t/p/h632/7mBwhDK6lQDGAqjIdqtYPYFYWlu.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1558263</profile>
    <tmdbid>1558263</tmdbid>
  </actor>
  <actor>
    <name>Mario Di Donato</name>
    <role>Fingerprint Forensic Man in Law Office</role>
    <thumb>https://image.tmdb.org/t/p/h632/jxrd9CN74vSbrW1spPtN8gmTAdw.jpg</thumb>
    <profile>https://www.themoviedb.org/person/176969</profile>
    <tmdbid>176969</tmdbid>
  </actor>
  <actor>
    <name>阿方索·弗里曼</name>
    <role>Fingerprint Technician</role>
    <thumb>https://image.tmdb.org/t/p/h632/9H4wX5clEpFfD3SG2JPoGH3LIgV.jpg</thumb>
    <profile>https://www.themoviedb.org/person/52603</profile>
    <tmdbid>52603</tmdbid>
  </actor>
  <actor>
    <name>约翰·C·麦金雷</name>
    <role>California</role>
    <thumb>https://image.tmdb.org/t/p/h632/a9Oc7STg83syQh3X22u2TroAifk.jpg</thumb>
    <profile>https://www.themoviedb.org/person/11885</profile>
    <tmdbid>11885</tmdbid>
  </actor>
  <actor>
    <name>Harrison White</name>
    <role>Cop on SWAT Team</role>
    <thumb>https://image.tmdb.org/t/p/h632/p0ocpENvbN7TXMkDUt5NVHMeN42.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1487328</profile>
    <tmdbid>1487328</tmdbid>
  </actor>
  <actor>
    <name>Bob Stephenson</name>
    <role>Cop on SWAT Team</role>
    <thumb>https://image.tmdb.org/t/p/h632/6RICLz0vofoGkI339Pk5sVn1657.jpg</thumb>
    <profile>https://www.themoviedb.org/person/17449</profile>
    <tmdbid>17449</tmdbid>
  </actor>
  <actor>
    <name>Michael Reid MacKay</name>
    <role>Victor - Sloth Victim</role>
    <thumb>https://image.tmdb.org/t/p/h632/saOH793fvLOPlvx8YVGdFT2orA4.jpg</thumb>
    <profile>https://www.themoviedb.org/person/174037</profile>
    <tmdbid>174037</tmdbid>
  </actor>
  <actor>
    <name>理查德·波特诺</name>
    <role>Dr. Beardsley</role>
    <thumb>https://image.tmdb.org/t/p/h632/uQZ3vSa2HHXywkDjGY8dN0oH5oY.jpg</thumb>
    <profile>https://www.themoviedb.org/person/4255</profile>
    <tmdbid>4255</tmdbid>
  </actor>
  <actor>
    <name>Tudor Sherrard</name>
    <role>Coupon Man Outside Pizza Parlor</role>
    <profile>https://www.themoviedb.org/person/2571346</profile>
    <tmdbid>2571346</tmdbid>
  </actor>
  <actor>
    <name>小马克·布恩</name>
    <role>Greasy F.B.I. Man</role>
    <thumb>https://image.tmdb.org/t/p/h632/swWzGOTX3SQ2udv7NQhAE1DlZsb.jpg</thumb>
    <profile>https://www.themoviedb.org/person/534</profile>
    <tmdbid>534</tmdbid>
  </actor>
  <actor>
    <name>Pamala Tyson</name>
    <role>Thin Vagrant by John Doe's Apartment</role>
    <thumb>https://image.tmdb.org/t/p/h632/g1wfV9MamNYzwE29NzHP6BZcuIY.jpg</thumb>
    <profile>https://www.themoviedb.org/person/128203</profile>
    <tmdbid>128203</tmdbid>
  </actor>
  <actor>
    <name>莱尼·洛夫廷</name>
    <role>Policeman Who Takes Statement from Vagrant</role>
    <thumb>https://image.tmdb.org/t/p/h632/tLCt8LjeumrCQvQfkrEbg7OQd4B.jpg</thumb>
    <profile>https://www.themoviedb.org/person/42200</profile>
    <tmdbid>42200</tmdbid>
  </actor>
  <actor>
    <name>Sarah Reinhardt</name>
    <role>Police Sketch Artist</role>
    <profile>https://www.themoviedb.org/person/2846278</profile>
    <tmdbid>2846278</tmdbid>
  </actor>
  <actor>
    <name>Emily Wagner</name>
    <role>Detective Sara at John Doe's Apartment</role>
    <thumb>https://image.tmdb.org/t/p/h632/q5bD23S8u4WkDxsAyYNs3ZNboS2.jpg</thumb>
    <profile>https://www.themoviedb.org/person/157434</profile>
    <tmdbid>157434</tmdbid>
  </actor>
  <actor>
    <name>Martin Serene</name>
    <role>Wild Bill</role>
    <thumb>https://image.tmdb.org/t/p/h632/xaj1t6LVwSZDafg3SJWXa4WUneZ.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1107809</profile>
    <tmdbid>1107809</tmdbid>
  </actor>
  <actor>
    <name>迈克尔·马西</name>
    <role>Man in Booth at Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/swlvVVcDhaJztxr3fgB04YGoX6I.jpg</thumb>
    <profile>https://www.themoviedb.org/person/9289</profile>
    <tmdbid>9289</tmdbid>
  </actor>
  <actor>
    <name>David Correia</name>
    <role>First Cop at Massage Parlor</role>
    <profile>https://www.themoviedb.org/person/91843</profile>
    <tmdbid>91843</tmdbid>
  </actor>
  <actor>
    <name>Ron Blair</name>
    <role>Second Cop at Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/5oGwlhXrk8HZoy6ZLKB0Ueyy4a2.jpg</thumb>
    <profile>https://www.themoviedb.org/person/4300063</profile>
    <tmdbid>4300063</tmdbid>
  </actor>
  <actor>
    <name>Jennifer Mueller</name>
    <role>Lust Victim</role>
    <profile>https://www.themoviedb.org/person/1642221</profile>
    <tmdbid>1642221</tmdbid>
  </actor>
  <actor>
    <name>利兰·奥瑟</name>
    <role>Crazed Man in Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/vvVcWhActW8k2gQz95UatVP4Duf.jpg</thumb>
    <profile>https://www.themoviedb.org/person/2221</profile>
    <tmdbid>2221</tmdbid>
  </actor>
  <actor>
    <name>Lexie Bigham</name>
    <role>Sweating Cop at Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/tphaLLDSABnp1oZAxS8FOQrndkA.jpg</thumb>
    <profile>https://www.themoviedb.org/person/9783</profile>
    <tmdbid>9783</tmdbid>
  </actor>
  <actor>
    <name>Evan Mirand</name>
    <role>Paramedic at Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/2juze2UWM22dWfoL2E6YLrKwsmH.jpg</thumb>
    <profile>https://www.themoviedb.org/person/175120</profile>
    <tmdbid>175120</tmdbid>
  </actor>
  <actor>
    <name>Paul Eckstein</name>
    <role>Paramedic at Massage Parlor</role>
    <thumb>https://image.tmdb.org/t/p/h632/htszpc0ehUrN8oXKZUw6TKauZKa.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1492029</profile>
    <tmdbid>1492029</tmdbid>
  </actor>
  <actor>
    <name>Harris Savides</name>
    <role>911 Operator</role>
    <thumb>https://image.tmdb.org/t/p/h632/4q3oGotUGSl9DA3Um7q2ds81dlx.jpg</thumb>
    <profile>https://www.themoviedb.org/person/10688</profile>
    <tmdbid>10688</tmdbid>
  </actor>
  <actor>
    <name>Rachel Flanagan</name>
    <role>Additional 911 Operator</role>
    <thumb>https://image.tmdb.org/t/p/h632/pI10KQrfCaUI87MJTgb5wlzsk4L.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1114784</profile>
    <tmdbid>1114784</tmdbid>
  </actor>
  <actor>
    <name>Heidi Schanz</name>
    <role>Pride Victim</role>
    <thumb>https://image.tmdb.org/t/p/h632/wweWS7u1rc9Ldq6lsnPmBeLV9lJ.jpg</thumb>
    <profile>https://www.themoviedb.org/person/11321</profile>
    <tmdbid>11321</tmdbid>
  </actor>
  <actor>
    <name>Brian Evers</name>
    <role>Duty Sergeant</role>
    <thumb>https://image.tmdb.org/t/p/h632/Ao2ty1y778OxBYC1mXzQp14GWLF.jpg</thumb>
    <profile>https://www.themoviedb.org/person/168162</profile>
    <tmdbid>168162</tmdbid>
  </actor>
  <actor>
    <name>Shannon Wilcox</name>
    <role>Woman Cop Behind Desk</role>
    <thumb>https://image.tmdb.org/t/p/h632/4GPHCEcw02i2QN94EGfRIu04ymV.jpg</thumb>
    <profile>https://www.themoviedb.org/person/95469</profile>
    <tmdbid>95469</tmdbid>
  </actor>
  <actor>
    <name>理查德·希夫</name>
    <role>Mark Swarr</role>
    <thumb>https://image.tmdb.org/t/p/h632/oFDka3Y5H3DBiZRqbdPabtX8ncP.jpg</thumb>
    <profile>https://www.themoviedb.org/person/31028</profile>
    <tmdbid>31028</tmdbid>
  </actor>
  <actor>
    <name>James Deeth</name>
    <role>Helicopter Pilot</role>
    <profile>https://www.themoviedb.org/person/54433</profile>
    <tmdbid>54433</tmdbid>
  </actor>
  <actor>
    <name>John Santin</name>
    <role>Helicopter Pilot</role>
    <profile>https://www.themoviedb.org/person/4300062</profile>
    <tmdbid>4300062</tmdbid>
  </actor>
  <actor>
    <name>Charles A. Tamburro</name>
    <role>SWAT Helicopter Pilot</role>
    <thumb>https://image.tmdb.org/t/p/h632/iCygZNkwUc2wSEIT58qUpiIkIC.jpg</thumb>
    <profile>https://www.themoviedb.org/person/16563</profile>
    <tmdbid>16563</tmdbid>
  </actor>
  <actor>
    <name>里士满·阿奎特</name>
    <role>Delivery Man</role>
    <thumb>https://image.tmdb.org/t/p/h632/7byGiVac0GjBSVD1h6ylZlVXZK6.jpg</thumb>
    <profile>https://www.themoviedb.org/person/7472</profile>
    <tmdbid>7472</tmdbid>
  </actor>
  <actor>
    <name>Duffy Gaver</name>
    <role>Marksman in Helicopter</role>
    <thumb>https://image.tmdb.org/t/p/h632/14yzdJuofSlzYvzfa4v8cSrSxFe.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1646992</profile>
    <tmdbid>1646992</tmdbid>
  </actor>
  <actor>
    <name>凯文·史派西</name>
    <role>John Doe</role>
    <thumb>https://image.tmdb.org/t/p/h632/nPrUZDEbGQe6jwpVbHKJCXsMd7r.jpg</thumb>
    <profile>https://www.themoviedb.org/person/1979</profile>
    <tmdbid>1979</tmdbid>
  </actor>
  <actor>
    <name>查尔斯·斯坦利·达顿</name>
    <role>Cop (uncredited)</role>
    <thumb>https://image.tmdb.org/t/p/h632/eNLs4JLILqSY50Tq5QMkrlBxD0H.jpg</thumb>
    <profile>https://www.themoviedb.org/person/17764</profile>
    <tmdbid>17764</tmdbid>
  </actor>
  <actor>
    <name>亚瑟·马克斯</name>
    <role>Man in Library (uncredited)</role>
    <thumb>https://image.tmdb.org/t/p/h632/kIh83DFSNqWQuHsR0CiKw3Qjf2n.jpg</thumb>
    <profile>https://www.themoviedb.org/person/944</profile>
    <tmdbid>944</tmdbid>
  </actor>
  <producer tmdbid="12048">
    <name>Phyllis Carlyle</name>
    <role>Producer</role>
    <profile>https://www.themoviedb.org/person/12048</profile>
  </producer>
  <producer tmdbid="10764">
    <name>Arnold Kopelson</name>
    <role>Producer</role>
    <thumb>https://image.tmdb.org/t/p/h632/zXDJcEm2cMcuWGw7YTC626hJMot.jpg</thumb>
    <profile>https://www.themoviedb.org/person/10764</profile>
  </producer>
  <producer tmdbid="12050">
    <name>Anne Kopelson</name>
    <role>Executive Producer</role>
    <profile>https://www.themoviedb.org/person/12050</profile>
  </producer>
  <producer tmdbid="5328">
    <name>Kerry Barden</name>
    <role>Casting</role>
    <profile>https://www.themoviedb.org/person/5328</profile>
  </producer>
  <producer tmdbid="3192">
    <name>Billy Hopkins</name>
    <role>Casting</role>
    <profile>https://www.themoviedb.org/person/3192</profile>
  </producer>
  <producer tmdbid="4023">
    <name>Suzanne Smith Crowley</name>
    <role>Casting</role>
    <thumb>https://image.tmdb.org/t/p/h632/eRIXIeMUQs8424iyDIRDKuPSBMy.jpg</thumb>
    <profile>https://www.themoviedb.org/person/4023</profile>
  </producer>
  <producer tmdbid="11815">
    <name>Dan Kolsrud</name>
    <role>Executive Producer</role>
    <profile>https://www.themoviedb.org/person/11815</profile>
  </producer>
  <producer tmdbid="1558238">
    <name>Robert S. Mendelsohn</name>
    <role>Unit Production Manager</role>
    <profile>https://www.themoviedb.org/person/1558238</profile>
  </producer>
  <producer tmdbid="112526">
    <name>Allan Wertheim</name>
    <role>Unit Production Manager</role>
    <profile>https://www.themoviedb.org/person/112526</profile>
  </producer>
  <producer tmdbid="91057">
    <name>Ted Zachary</name>
    <role>Executive In Charge Of Production</role>
    <profile>https://www.themoviedb.org/person/91057</profile>
  </producer>
  <producer tmdbid="12775">
    <name>Joe Fineman</name>
    <role>Executive In Charge Of Post Production</role>
    <profile>https://www.themoviedb.org/person/12775</profile>
  </producer>
  <producer tmdbid="18782">
    <name>Michele Platt</name>
    <role>Associate Producer</role>
    <profile>https://www.themoviedb.org/person/18782</profile>
  </producer>
  <producer tmdbid="1401354">
    <name>Wendy Cox</name>
    <role>Production Coordinator</role>
    <profile>https://www.themoviedb.org/person/1401354</profile>
  </producer>
  <producer tmdbid="1558240">
    <name>Paul Hargrave</name>
    <role>Location Manager</role>
    <profile>https://www.themoviedb.org/person/1558240</profile>
  </producer>
  <producer tmdbid="27039">
    <name>Aisha Coley</name>
    <role>Casting Associate</role>
    <profile>https://www.themoviedb.org/person/27039</profile>
  </producer>
  <producer tmdbid="1558267">
    <name>Sanford Panitch</name>
    <role>Co-Producer</role>
    <profile>https://www.themoviedb.org/person/1558267</profile>
  </producer>
  <producer tmdbid="69895">
    <name>Nana Greenwald</name>
    <role>Co-Producer</role>
    <profile>https://www.themoviedb.org/person/69895</profile>
  </producer>
  <producer tmdbid="57076">
    <name>Stephen Joel Brown</name>
    <role>Co-Producer</role>
    <profile>https://www.themoviedb.org/person/57076</profile>
  </producer>
  <producer tmdbid="65753">
    <name>Richard Saperstein</name>
    <role>Co-Executive Producer</role>
    <profile>https://www.themoviedb.org/person/65753</profile>
  </producer>
  <producer tmdbid="4768">
    <name>Lynn Harris</name>
    <role>Co-Executive Producer</role>
    <thumb>https://image.tmdb.org/t/p/h632/gDR95fKQ8ZC6D7isveC7mXd0jgU.jpg</thumb>
    <profile>https://www.themoviedb.org/person/4768</profile>
  </producer>
  <producer tmdbid="11420">
    <name>Gianni Nunnari</name>
    <role>Executive Producer</role>
    <profile>https://www.themoviedb.org/person/11420</profile>
  </producer>
  <producer tmdbid="950637">
    <name>William C. Gerrity</name>
    <role>Line Producer</role>
    <profile>https://www.themoviedb.org/person/950637</profile>
  </producer>
  <producer tmdbid="5290">
    <name>Kim Taylor-Coleman</name>
    <role>Casting Assistant</role>
    <thumb>https://image.tmdb.org/t/p/h632/9I6k3ecW0l8WECCBDoIJGMQ5zdU.jpg</thumb>
    <profile>https://www.themoviedb.org/person/5290</profile>
  </producer>
  <producer tmdbid="1522742">
    <name>Jennifer McNamara</name>
    <role>Casting Assistant</role>
    <profile>https://www.themoviedb.org/person/1522742</profile>
  </producer>
  <producer tmdbid="4088694">
    <name>Maria Norman</name>
    <role>Executive Assistant</role>
    <profile>https://www.themoviedb.org/person/4088694</profile>
  </producer>
  <producer tmdbid="2185618">
    <name>Robert Grindrod</name>
    <role>Production Accountant</role>
    <profile>https://www.themoviedb.org/person/2185618</profile>
  </producer>
  <producer tmdbid="2136421">
    <name>François Frey</name>
    <role>Publicist</role>
    <profile>https://www.themoviedb.org/person/2136421</profile>
  </producer>
  <producer tmdbid="1749921">
    <name>Flint Maloney</name>
    <role>Assistant Location Manager</role>
    <profile>https://www.themoviedb.org/person/1749921</profile>
  </producer>
  <producer tmdbid="2354626">
    <name>Joe Johnston</name>
    <role>Location Assistant</role>
    <profile>https://www.themoviedb.org/person/2354626</profile>
  </producer>
  <producer tmdbid="2354634">
    <name>Craig Albrecht</name>
    <role>Art Department Production Assistant</role>
    <profile>https://www.themoviedb.org/person/2354634</profile>
  </producer>
  <producer tmdbid="2299066">
    <name>John L. Anderson</name>
    <role>Assistant Production Coordinator</role>
    <profile>https://www.themoviedb.org/person/2299066</profile>
  </producer>
  <producer tmdbid="2354636">
    <name>Jerri Whiteman</name>
    <role>First Assistant Accountant</role>
    <profile>https://www.themoviedb.org/person/2354636</profile>
  </producer>
  <producer tmdbid="1099750">
    <name>Brad Davis</name>
    <role>Payroll Accountant</role>
    <profile>https://www.themoviedb.org/person/1099750</profile>
  </producer>
  <producer tmdbid="2156298">
    <name>Gary A. Martin</name>
    <role>Production Assistant</role>
    <profile>https://www.themoviedb.org/person/2156298</profile>
  </producer>
  <producer tmdbid="1400877">
    <name>Janet Ingram</name>
    <role>Production Secretary</role>
    <profile>https://www.themoviedb.org/person/1400877</profile>
  </producer>
  <trailer/>
  <languages>英语</languages>
  <dateadded>2025-08-10 12:39:00</dateadded>
  <fileinfo>
    <streamdetails>
      <video>
        <codec>VC-1</codec>
        <aspect>1.78</aspect>
        <width>1920</width>
        <height>1080</height>
        <durationinseconds>7615</durationinseconds>
      </video>
      <audio>
        <codec>DTSHD_MA</codec>
        <language/>
        <channels>8</channels>
      </audio>
      <audio>
        <codec>DTS</codec>
        <language/>
        <channels>6</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>6</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>2</channels>
      </audio>
      <audio>
        <codec>DTS</codec>
        <language/>
        <channels>6</channels>
      </audio>
      <audio>
        <codec>DTSHD_HRA</codec>
        <language/>
        <channels>8</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>2</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>2</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>2</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>6</channels>
      </audio>
      <audio>
        <codec>AC3</codec>
        <language/>
        <channels>6</channels>
      </audio>
    </streamdetails>
  </fileinfo>
  <!--tinyMediaManager meta data-->
  <source>UNKNOWN</source>
  <edition>NONE</edition>
  <original_filename>农场的七宗罪.mkv</original_filename>
  <user_note/>
</movie>
`
  }

  return {
    scrapeMovieInFolder,
    cleanOldMovieFiles,
    handleSearchParams,
    searchMovieInfo,
  }
}
