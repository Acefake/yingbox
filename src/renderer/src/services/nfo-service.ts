/**
 * NFO 文件服务
 * 处理 NFO 文件的生成和解析
 */
import type { MovieInfoType } from '@/types'
import { FileService } from '@/services/file-service'

export class NfoService {
  /**
   * 生成 NFO 文件内容
   */
  static generateNfoContent(movie: any, movieName: string): string {
    const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${this.escapeXml(movie.title || movieName)}</title>
  <originaltitle>${this.escapeXml(movie.original_title || movie.title || movieName)}</originaltitle>
  ${movie.release_date ? `<year>${movie.release_date.substring(0, 4)}</year>` : ''}
  ${movie.overview ? `<plot>${this.escapeXml(movie.overview)}</plot>` : ''}
  ${movie.genres?.map((g: any) => `<genre>${this.escapeXml(g.name)}</genre>`).join('\n  ') || ''}
  ${
    movie.credits?.crew
      ?.filter((c: any) => c.job === 'Director')
      .map((d: any) => `<director>${this.escapeXml(d.name)}</director>`)
      .join('\n  ') || ''
  }
  ${
    movie.credits?.cast
      ?.slice(0, 10)
      .map(
        (a: any) =>
          `<actor><name>${this.escapeXml(a.name)}</name><role>${this.escapeXml(a.character || '')}</role></actor>`
      )
      .join('\n  ') || ''
  }
  ${movie.vote_average ? `<rating>${movie.vote_average.toFixed(1)}</rating>` : ''}
  ${movie.runtime ? `<runtime>${movie.runtime}</runtime>` : ''}
  ${movie.production_countries?.[0]?.name ? `<country>${this.escapeXml(movie.production_countries[0].name)}</country>` : ''}
  ${movie.production_companies?.[0]?.name ? `<studio>${this.escapeXml(movie.production_companies[0].name)}</studio>` : ''}
  ${movie.release_date ? `<premiered>${movie.release_date}</premiered>` : ''}
</movie>`
    return nfoContent
  }

  /**
   * 解析 NFO 文件内容
   */
  static parseNfoContent(content: string): MovieInfoType | null {
    if (!content) return null

    try {
      const info: MovieInfoType = {}

      // 提取标题
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i)
      if (titleMatch) info.title = titleMatch[1].trim()

      // 提取原始标题
      const originalTitleMatch = content.match(
        /<originaltitle>([^<]+)<\/originaltitle>/i
      )
      if (originalTitleMatch) info.originaltitle = originalTitleMatch[1].trim()

      // 提取年份
      const yearMatch = content.match(/<year>(\d{4})<\/year>/i)
      if (yearMatch) info.year = yearMatch[1]

      // 提取剧情简介
      const plotMatch = content.match(/<plot>([^<]+)<\/plot>/i)
      if (plotMatch) info.plot = plotMatch[1].trim()

      // 提取类型
      const genreMatches = content.match(/<genre>([^<]+)<\/genre>/gi)
      if (genreMatches) {
        info.genre = genreMatches.map(match =>
          match.replace(/<\/?genre>/gi, '').trim()
        )
      }

      // 提取导演
      const directorMatch = content.match(/<director>([^<]+)<\/director>/i)
      if (directorMatch) info.director = directorMatch[1].trim()

      // 提取演员
      const actorMatches = content.match(/<actor>\s*<name>([^<]+)<\/name>/gi)
      if (actorMatches) {
        info.actor = actorMatches
          .map(match => {
            const nameMatch = match.match(/<name>([^<]+)<\/name>/i)
            return nameMatch ? nameMatch[1].trim() : ''
          })
          .filter(name => name)
      }

      // 提取评分
      const ratingMatch = content.match(/<rating>([^<]+)<\/rating>/i)
      if (ratingMatch) info.rating = ratingMatch[1].trim()

      // 提取时长
      const runtimeMatch = content.match(/<runtime>([^<]+)<\/runtime>/i)
      if (runtimeMatch) info.runtime = runtimeMatch[1].trim()

      // 提取国家
      const countryMatch = content.match(/<country>([^<]+)<\/country>/i)
      if (countryMatch) info.country = countryMatch[1].trim()

      // 提取制片公司
      const studioMatch = content.match(/<studio>([^<]+)<\/studio>/i)
      if (studioMatch) info.studio = studioMatch[1].trim()

      // 提取首映日期
      const premieredMatch = content.match(/<premiered>([^<]+)<\/premiered>/i)
      if (premieredMatch) info.premiered = premieredMatch[1].trim()

      return info
    } catch (error) {
      console.error('解析NFO内容失败:', error)
      return null
    }
  }

  /**
   * 写入 NFO 文件
   */
  static async writeNfoFile(
    folderPath: string,
    movieName: string,
    movie: any
  ): Promise<boolean> {
    const nfoPath = await window.api.path.join(
      folderPath,
      `${FileService.cleanMovieName(movieName)}.nfo`
    )
    const nfoContent = this.generateNfoContent(movie, movieName)

    const result = await FileService.writeFile(nfoPath, nfoContent)
    return result.success
  }

  /**
   * 读取并解析 NFO 文件
   */
  static async readNfoFile(nfoPath: string): Promise<MovieInfoType | null> {
    const result = await FileService.readFile(nfoPath)

    if (!result.success || !result.data) {
      return null
    }

    return this.parseNfoContent(result.data as string)
  }

  /**
   * 转义 XML 特殊字符
   */
  private static escapeXml(str: string): string {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
