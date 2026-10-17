import { getImageBaseUrl, getTmdb } from '@/api/tmdb'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { backend } from '@/api/backend'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { ref } from 'vue'
import type { ProcessedItem } from '@/types'
import type { CastMember, DirectorMember, ScrapedMovie } from '@/types/scraping'
import { generateNfo, parseNfo } from '@/services/nfo-service'
import { cleanSearchParams, extractAvid } from '@/utils/avid'
import { safeFileName } from '@/utils/file-name'
import { downloadWithRetry, finishDownloads } from '@/services/download-service'
import { fetchActorPhoto } from '@/services/actor-cache-service'

const getMetaLang = (): string =>
  (typeof window !== 'undefined' && localStorage.getItem('metadataLanguage')) ||
  'zh-CN'

// ─── 主 Hook ───────────────────────────────

export const useScraping = () => {
  const currentScrapeItem = ref<ProcessedItem>()

  /**
   * 搜索电影（支持 TMDB / JavBus / 本地 NFO）
   */
  const searchMovieInfo = async (
    item: ProcessedItem
  ): Promise<ScrapedMovie[]> => {
    try {
      currentScrapeItem.value = item

      // 已有 NFO → 从本地构建候选
      if (item.hasNfo && item.files) {
        const nfoFile = item.files.find(f =>
          f.name.toLowerCase().endsWith('.nfo')
        )
        if (nfoFile) {
          const readResult = await window.api.file.read(nfoFile.path)
          if (readResult.success && readResult.data) {
            const nfoData = parseNfo(readResult.data as string)
            if (nfoData.title || nfoData.tmdbid) {
              const movieFromNfo: ScrapedMovie = {
                id: nfoData.tmdbid ? parseInt(nfoData.tmdbid) : 0,
                title: nfoData.title || item.name,
                original_title: nfoData.originaltitle || '',
                overview: nfoData.plot || '',
                release_date:
                  nfoData.premiered || `${nfoData.year || ''}-01-01`,
                vote_average: nfoData.rating ? parseFloat(nfoData.rating) : 0,
                vote_count: nfoData.votes ? parseInt(nfoData.votes) : 0,
                poster_path: nfoData.poster || '',
                backdrop_path: nfoData.backdrop || '',
                adult: false,
                genre_ids: [],
                original_language: '',
                popularity: 0,
                video: false,
              }
              return [movieFromNfo]
            }
          }
        }
      }

      // 提取搜索关键词
      const searchName =
        item.type === 'folder' ? item.name : item.name.replace(/\.[^.]*$/, '')

      const provider = getScrapeProviderConfig().provider

      // ── JavBus ──
      if (provider === 'javbus') {
        const avid = extractAvid(searchName)
        if (!avid) return []
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
            } as ScrapedMovie,
          ]
        } catch (e) {
          console.error('JavBus 获取元数据失败:', e)
          return []
        }
      }

      // ── TMDB 搜索（带回退策略）──
      const cleanName = cleanSearchParams(searchName)
      if (!cleanName) return []

      const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
      const year = yearMatch ? parseInt(yearMatch[0]) : undefined
      const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

      const query = nameWithoutYear || cleanName
      const lang = getMetaLang()

      try {
        // 第一次搜索：本地语言 + 年份
        let res = await getTmdb().search.movies({
          query,
          language: lang,
          ...(year && { year }),
        })

        // 回退：并行发起不带年份和英文搜索
        if (res.results.length === 0) {
          const fallbacks: Promise<any>[] = []
          if (year) {
            fallbacks.push(getTmdb().search.movies({ query, language: lang }))
          }
          if (lang !== 'en-US') {
            fallbacks.push(
              getTmdb().search.movies({
                query,
                language: 'en-US',
                ...(year && { year }),
              })
            )
          }
          if (fallbacks.length > 0) {
            const results = await Promise.all(fallbacks)
            for (const r of results) {
              if (r.results.length > 0) {
                res = r
                break
              }
            }
          }
        }

        if (res.results.length === 0) return []

        return res.results.map(
          (movie: Movie): ScrapedMovie => ({
            ...movie,
            poster_path: movie.poster_path
              ? getImageBaseUrl('poster') + movie.poster_path
              : '',
            backdrop_path: movie.backdrop_path
              ? getImageBaseUrl('backdrop') + movie.backdrop_path
              : '',
          })
        )
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
   * 清理文件夹中属于指定视频的旧资源文件
   * 只删除匹配 videoBaseName 的 NFO/海报/背景图，不影响其他视频的文件
   */
  /**
   * 在指定文件夹中刮削电影信息（下载海报和创建NFO文件）
   * @throws 失败时抛出错误，让调用方感知
   */
  const scrapeMovieInFolder = async (
    movieData: ScrapedMovie,
    folderPath: string,
    videoBaseName: string,
    progressCallback?: (step: string, stepIndex: number) => void
  ): Promise<void> => {
    // 如果是 JavBus，先获取详情
    if (!movieData._javbus && movieData.id) {
      progressCallback?.('正在获取电影详情...', 0)
      try {
        const details = (await getTmdb().movies.details(
          movieData.id as number
        )) as any
        if (details.backdrop_path && !movieData.backdrop_path) {
          movieData.backdrop_path = `${getImageBaseUrl('backdrop')}${details.backdrop_path}`
        }
        movieData.genres = details.genres || []
        movieData.runtime = details.runtime || 0
        movieData.production_countries = details.production_countries || []
        movieData.production_companies = details.production_companies || []
      } catch (e) {
        console.warn('获取电影详情失败:', e)
      }
    }

    // TMDB 路径：获取演职员信息
    if (!movieData._javbus && movieData.id) {
      const { directors, cast } = await getMovieCredits(movieData.id)
      movieData.directors = directors
      movieData.cast = cast

      // 并行下载演员照片
      if (cast.length > 0) {
        progressCallback?.('正在下载演员照片...', 4)
        const actorsDir = await window.api.path.join(folderPath, '.actors')
        const directory = await window.api.file.mkdir(actorsDir)
        if (!directory.success)
          throw new Error(directory.error || '创建演员目录失败')

        await finishDownloads(
          cast
            .filter(actor => actor.profile_path)
            .map(actor => {
              const photoUrl = actor.profile_path!.startsWith('http')
                ? actor.profile_path!
                : `${getImageBaseUrl('actor')}${actor.profile_path}`
              const safeName = safeFileName(actor.name, 'actor')
              return window.api.path
                .join(actorsDir, `${safeName}.jpg`)
                .then(photoPath =>
                  fetchActorPhoto(String(actor.id), photoUrl, photoPath)
                )
            })
        )
      }
    }

    // 每个资源完整写入后替换原文件，保留字幕、共享演员图和已有资源。

    // 构建文件路径
    const nfoPath = await window.api.path.join(
      folderPath,
      `${videoBaseName}.nfo`
    )
    const posterFileNames = [
      `${videoBaseName}-poster.jpg`,
      `${videoBaseName}-movie.jpg`,
      `${videoBaseName}-folder.jpg`,
    ]
    const posterPaths = await Promise.all(
      posterFileNames.map(async fileName => ({
        fileName,
        path: await window.api.path.join(folderPath, fileName),
      }))
    )

    // ── 写入 NFO ──
    const nfoContent = generateNfo(movieData)
    progressCallback?.('正在写入NFO文件...', 1)
    const nfoResult = await window.api.file.write(nfoPath, nfoContent)
    if (!nfoResult.success) {
      throw new Error(`创建NFO文件失败: ${nfoResult.error}`)
    }

    // ── 下载海报（并行下载所有副本）──
    const javbusMeta = movieData._javbus
    if (javbusMeta?.cover || movieData.poster_path) {
      progressCallback?.('正在下载海报...', 2)
      const posterUrl = javbusMeta
        ? backend.proxyUrl(javbusMeta.cover)
        : movieData.poster_path!.startsWith('http')
          ? movieData.poster_path!
          : `${getImageBaseUrl('poster')}${movieData.poster_path}`

      await finishDownloads(
        posterPaths.map(({ path }) => downloadWithRetry(posterUrl, path))
      )
    }

    // ── 下载背景图（并行）──
    const fanartSources: string[] = []
    if (javbusMeta?.fanarts?.length) {
      fanartSources.push(
        ...javbusMeta.fanarts.map((url: string) => backend.proxyUrl(url))
      )
    } else if (movieData.backdrop_path) {
      const url = movieData.backdrop_path.startsWith('http')
        ? movieData.backdrop_path
        : `${getImageBaseUrl('backdrop')}${movieData.backdrop_path}`
      fanartSources.push(url)
    }

    if (fanartSources.length > 0) {
      progressCallback?.('正在下载背景图...', 3)
      await finishDownloads(
        fanartSources.map((url, i) => {
          const name =
            i === 0
              ? `${videoBaseName}-fanart.jpg`
              : `${videoBaseName}-fanart-${i}.jpg`
          return window.api.path
            .join(folderPath, name)
            .then(path => downloadWithRetry(url, path))
        })
      )
    }

    // ── JavBus 演员照片（并行）──
    if (javbusMeta?.actress && Object.keys(javbusMeta.actress).length) {
      progressCallback?.('正在下载演员照片...', 4)
      const actorsDir = await window.api.path.join(folderPath, '.actors')
      const directory = await window.api.file.mkdir(actorsDir)
      if (!directory.success)
        throw new Error(directory.error || '创建演员目录失败')

      await finishDownloads(
        Object.entries(javbusMeta.actress as Record<string, string>)
          .filter(([, imgUrl]) => imgUrl)
          .map(([name, imgUrl]) => {
            const safeName = safeFileName(name, 'actor')
            return window.api.path
              .join(actorsDir, `${safeName}.jpg`)
              .then(photoPath =>
                fetchActorPhoto(safeName, backend.proxyUrl(imgUrl), photoPath)
              )
          })
      )
    }

    console.log('电影刮削完成:', videoBaseName)
  }

  /**
   * 获取电影演职员信息
   */
  const getMovieCredits = async (
    movieId: number
  ): Promise<{ directors: DirectorMember[]; cast: CastMember[] }> => {
    try {
      const credits = await getTmdb().movies.credits(movieId)

      const directors: DirectorMember[] = credits.crew
        .filter((person: any) => person.job === 'Director')
        .map((director: any) => ({
          id: director.id,
          name: director.name,
          profile_path: director.profile_path,
          tmdbid: director.id,
        }))

      const cast: CastMember[] = credits.cast
        .slice(0, 10)
        .map((actor: any) => ({
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

  return {
    scrapeMovieInFolder,
    searchMovieInfo,
  }
}
