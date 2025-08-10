import { ref, computed } from 'vue'
import type { TVInfoType, Season } from '@/types'
import { tmdb } from '@/api/tmdb'

/**
 * 电视剧元数据管理Hook
 * 
 * 提供电视剧搜索、信息获取、季集管理等功能
 * 包括TMDB API调用、数据缓存和状态管理
 */
export const useTVMetadata = () => {
  // 响应式状态
  const tvInfo = ref<TVInfoType | null>(null)
  const seasons = ref<Season[]>([])
  const isLoading = ref(false)
  const isSearching = ref(false)
  const searchResults = ref<any[]>([])
  const error = ref<string | null>(null)

  /**
   * 搜索电视剧
   * @param query 搜索关键词
   * @param year 年份（可选）
   */
  const searchTV = async (query: string, year?: number) => {
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
        searchParams.first_air_date_year = year
      }

      const response = await tmdb.search.tv(searchParams)
      searchResults.value = response.results || []
    } catch (err) {
      console.error('搜索电视剧失败:', err)
      error.value = '搜索失败，请检查网络连接'
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }

  /**
   * 根据TMDB ID获取电视剧详细信息
   * @param tvId TMDB电视剧ID
   */
  const getTVDetails = async (tvId: number) => {
    isLoading.value = true
    error.value = null

    try {
      // 获取电视剧基本信息
      const [detailsResponse, externalIdsResponse] = await Promise.all([
        tmdb.tv.details(tvId, { language: 'zh-CN' }),
        tmdb.tv.externalIds(tvId)
      ])

      // 合并外部ID信息
      const tvData = {
        ...detailsResponse,
        external_ids: externalIdsResponse
      }

      tvInfo.value = tvData as TVInfoType
      
      // 获取季信息
      if (tvData.seasons) {
        seasons.value = tvData.seasons.filter((season: any) => season.season_number > 0)
      }

      return tvData
    } catch (err) {
      console.error('获取电视剧详情失败:', err)
      error.value = '获取电视剧信息失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 获取指定季的详细信息
   * @param tvId TMDB电视剧ID
   * @param seasonNumber 季号
   */
  const getSeasonDetails = async (tvId: number, seasonNumber: number) => {
    try {
      const response = await tmdb.tv.season.details(tvId, seasonNumber, {
        language: 'zh-CN'
      })
      return response
    } catch (err) {
      console.error(`获取第${seasonNumber}季详情失败:`, err)
      throw err
    }
  }

  /**
   * 获取电视剧图片
   * @param tvId TMDB电视剧ID
   */
  const getTVImages = async (tvId: number) => {
    try {
      const response = await tmdb.tv.images(tvId)
      return response
    } catch (err) {
      console.error('获取电视剧图片失败:', err)
      throw err
    }
  }

  /**
   * 从文件名解析电视剧信息
   * @param filename 文件名
   */
  const parseFilename = (filename: string) => {
    // 移除文件扩展名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    
    // 尝试匹配年份
    const yearMatch = nameWithoutExt.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined
    
    // 尝试匹配季集信息
    const seasonEpisodeMatch = nameWithoutExt.match(/[Ss](\d+)[Ee](\d+)/)
    const seasonMatch = nameWithoutExt.match(/[Ss]eason\s*(\d+)/i)
    
    let seasonNumber: number | undefined
    let episodeNumber: number | undefined
    
    if (seasonEpisodeMatch) {
      seasonNumber = parseInt(seasonEpisodeMatch[1])
      episodeNumber = parseInt(seasonEpisodeMatch[2])
    } else if (seasonMatch) {
      seasonNumber = parseInt(seasonMatch[1])
    }
    
    // 清理标题（移除年份、季集信息等）
    let cleanTitle = nameWithoutExt
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/[Ss]\d+[Ee]\d+/g, '')
      .replace(/[Ss]eason\s*\d+/gi, '')
      .replace(/[\[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    return {
      title: cleanTitle,
      year,
      seasonNumber,
      episodeNumber
    }
  }

  /**
   * 清除当前数据
   */
  const clearData = () => {
    tvInfo.value = null
    seasons.value = []
    searchResults.value = []
    error.value = null
  }

  // 计算属性
  const hasData = computed(() => !!tvInfo.value)
  const hasSeasons = computed(() => seasons.value.length > 0)
  const hasSearchResults = computed(() => searchResults.value.length > 0)

  return {
    // 状态
    tvInfo,
    seasons,
    isLoading,
    isSearching,
    searchResults,
    error,
    
    // 计算属性
    hasData,
    hasSeasons,
    hasSearchResults,
    
    // 方法
    searchTV,
    getTVDetails,
    getSeasonDetails,
    getTVImages,
    parseFilename,
    clearData
  }
}