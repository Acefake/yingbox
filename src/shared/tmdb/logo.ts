/**
 * TMDB 标志图（透明底的片名图）：首页轮播有标志图时显示它，没有退回文字标题（与桌面端电影、电视剧详情头图一致）。
 */
import { asArray, asRecord, asText } from '../json'

/** 标志图地址前缀：500 宽够轮播用 */
export const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w500'

/** 语言优先级：中文最好，其次英文、无文字的；别的语言（日文、法文…）不要 */
const languageRank = (language: unknown): number =>
  language === 'zh'
    ? 0
    : language === 'en'
      ? 1
      : language === null || language === undefined || language === ''
        ? 2
        : 3

/**
 * 从 `/{movie|tv}/{id}/images` 的结果里挑一张标志图。
 * 中文优先，其次英文、无文字的，同一语言里评分高、宽度大的在前；SVG 不要（客户端解不了）。
 * 没有合适的返回 null。
 */
export function pickLogo(images: unknown): string | null {
  const logos = asArray(asRecord(images)?.logos).flatMap(raw => {
    const logo = asRecord(raw)
    const path = asText(logo?.file_path)
    if (!logo || !path || /\.svg$/i.test(path)) return []
    return [
      {
        path,
        rank: languageRank(logo.iso_639_1),
        vote: Number(logo.vote_average) || 0,
        width: Number(logo.width) || 0,
      },
    ]
  })
  logos.sort((a, b) => a.rank - b.rank || b.vote - a.vote || b.width - a.width)
  const best = logos[0]
  return best && best.rank <= 2 ? TMDB_LOGO_BASE + best.path : null
}
