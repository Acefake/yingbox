import { ref, computed, reactive } from 'vue'
import type { MovieInfoType, MovieSearchResult, MovieSearchResponse, MovieNFOData } from '@/types'
// import { tmdbApi } from '@/api/tmdb' // TODO: 实现TMDB API

/**
 * 电影元数据管理Hook
 * 
 * 提供电影搜索、信息获取、NFO解析等功能
 * 包括TMDB API调用、数据缓存和状态管理
 */
export const useMovieMetadata = () => {
  // 响应式状态
  const movieInfo = ref<MovieInfoType | null>(null)
  const isLoading = ref(false)
  const isSearching = ref(false)
  const searchResults = ref<any[]>([])
  const error = ref<string | null>(null)

  /**
   * 搜索电影
   * @param query 搜索关键词
   * @param year 年份（可选）
   */
  const searchMovie = async (query: string, year?: number) => {
    if (!query.trim()) {
      searchResults.value = []
      return
    }

    isSearching.value = true
    error.value = null

    try {
      const searchParams: any = {
        query: query.trim(),
        language: 'zh-CN'
      }

      if (year) {
        searchParams.year = year
      }

      const response = await tmdb.search.movie(searchParams)
      searchResults.value = response.results || []
    } catch (err) {
      console.error('搜索电影失败:', err)
      error.value = '搜索失败，请检查网络连接'
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }

  /**
   * 根据TMDB ID获取电影详细信息
   * @param movieId TMDB电影ID
   */
  const getMovieDetails = async (movieId: number) => {
    isLoading.value = true
    error.value = null

    try {
      // 获取电影详细信息，包括演员、工作人员等
      const response = await tmdb.movie.details(movieId, {
        language: 'zh-CN',
        append_to_response: 'credits,images,videos'
      })

      movieInfo.value = response as MovieInfoType
      return response
    } catch (err) {
      console.error('获取电影详情失败:', err)
      error.value = '获取电影信息失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 获取电影图片
   * @param movieId TMDB电影ID
   */
  const getMovieImages = async (movieId: number) => {
    try {
      const response = await tmdb.movie.images(movieId)
      return response
    } catch (err) {
      console.error('获取电影图片失败:', err)
      throw err
    }
  }

  /**
   * 从文件名解析电影信息
   * @param filename 文件名
   */
  const parseFilename = (filename: string) => {
    // 移除文件扩展名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    
    // 尝试匹配年份
    const yearMatch = nameWithoutExt.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined
    
    // 尝试匹配分辨率
    const resolutionMatch = nameWithoutExt.match(/\b(720p|1080p|2160p|4K)\b/i)
    const resolution = resolutionMatch ? resolutionMatch[0] : undefined
    
    // 清理标题（移除年份、分辨率、编码信息等）
    let cleanTitle = nameWithoutExt
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/\b(720p|1080p|2160p|4K)\b/gi, '')
      .replace(/\b(x264|x265|h264|h265|hevc)\b/gi, '')
      .replace(/\b(bluray|bdrip|webrip|dvdrip|hdtv)\b/gi, '')
      .replace(/[\[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    return {
      title: cleanTitle,
      year,
      resolution
    }
  }

  /**
   * 从NFO文件解析电影信息
   * @param nfoContent NFO文件内容
   */
  const parseNFO = (nfoContent: string) => {
    try {
      // 尝试解析XML格式的NFO
      const parser = new DOMParser()
      const doc = parser.parseFromString(nfoContent, 'text/xml')
      
      // 检查是否有解析错误
      const parseError = doc.querySelector('parsererror')
      if (parseError) {
        throw new Error('NFO格式错误')
      }
      
      const movieElement = doc.querySelector('movie')
      if (!movieElement) {
        throw new Error('NFO中未找到电影信息')
      }
      
      // 提取基本信息
      const title = movieElement.querySelector('title')?.textContent || ''
      const year = movieElement.querySelector('year')?.textContent || ''
      const plot = movieElement.querySelector('plot')?.textContent || ''
      const rating = movieElement.querySelector('rating')?.textContent || ''
      const runtime = movieElement.querySelector('runtime')?.textContent || ''
      const tmdbId = movieElement.querySelector('tmdbid')?.textContent || ''
      const imdbId = movieElement.querySelector('imdbid')?.textContent || ''
      
      // 提取类型信息
      const genreElements = movieElement.querySelectorAll('genre')
      const genres = Array.from(genreElements).map(el => el.textContent || '')
      
      return {
        title,
        year: year ? parseInt(year) : undefined,
        plot,
        rating: rating ? parseFloat(rating) : undefined,
        runtime: runtime ? parseInt(runtime) : undefined,
        tmdbId: tmdbId ? parseInt(tmdbId) : undefined,
        imdbId,
        genres
      }
    } catch (err) {
      console.error('解析NFO失败:', err)
      return null
    }
  }

  /**
   * 生成NFO文件内容
   * @param movieData 电影数据
   */
  const generateNFO = (movieData: MovieInfoType) => {
    const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${movieData.title || ''}</title>
  <originaltitle>${movieData.original_title || ''}</originaltitle>
  <year>${movieData.release_date ? new Date(movieData.release_date).getFullYear() : ''}</year>
  <releasedate>${movieData.release_date || ''}</releasedate>
  <plot>${movieData.overview || ''}</plot>
  <tagline>${movieData.tagline || ''}</tagline>
  <runtime>${movieData.runtime || ''}</runtime>
  <rating>${movieData.vote_average || ''}</rating>
  <votes>${movieData.vote_count || ''}</votes>
  <tmdbid>${movieData.id || ''}</tmdbid>
  <imdbid>${movieData.imdb_id || ''}</imdbid>
  <language>${movieData.original_language || ''}</language>
  <status>${movieData.status || ''}</status>
  <budget>${movieData.budget || ''}</budget>
  <revenue>${movieData.revenue || ''}</revenue>
${movieData.genres?.map(genre => `  <genre>${genre.name}</genre>`).join('\n') || ''}
${movieData.production_companies?.map(company => `  <studio>${company.name}</studio>`).join('\n') || ''}
${movieData.production_countries?.map(country => `  <country>${country.name}</country>`).join('\n') || ''}
</movie>`
    
    return nfoContent
  }

  /**
   * 清除当前数据
   */
  const clearData = () => {
    movieInfo.value = null
    searchResults.value = []
    error.value = null
  }

  // 计算属性
  const hasData = computed(() => !!movieInfo.value)
  const hasSearchResults = computed(() => searchResults.value.length > 0)

  return {
    // 状态
    movieInfo,
    isLoading,
    isSearching,
    searchResults,
    error,
    
    // 计算属性
    hasData,
    hasSearchResults,
    
    // 方法
    searchMovie,
    getMovieDetails,
    getMovieImages,
    parseFilename,
    parseNFO,
    generateNFO,
    clearData
  }
}