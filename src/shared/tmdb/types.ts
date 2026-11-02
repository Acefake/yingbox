/** TMDB 的数据形状（只声明用到的字段），渲染层与服务端共用。 */

/** TMDB 影片 / 剧集详情：只声明详情页读的字段 */
export interface TmdbDetail {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number
  release_date?: string
  first_air_date?: string
  runtime?: number
  imdb_id?: string | null
  genres?: { id: number; name: string }[]
  production_countries?: { name: string }[]
}
