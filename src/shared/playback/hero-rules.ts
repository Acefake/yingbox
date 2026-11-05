/**
 * 首页 Hero 选片的纯规则：只放精选（片库新入库 / 豆瓣热门），同一部只出现一次，最多 HERO_SLIDES 张。
 * 继续观看不进轮播，它有自己的一排（ContinueRow，首页合并 HOME_SECTIONS 里的板块）。
 *
 * 不依赖 Vue；继续观看记录的形状见同目录的 continue-rules.ts。
 */
import type { ContinueSection } from './continue-rules'

/** 轮播最多几页 */
export const HERO_SLIDES = 5

/** 首页的继续观看合并的板块：在线与片库电影、剧集（番号、AV 是私密板块，不上首页） */
export const HOME_SECTIONS: readonly ContinueSection[] = [
  'online',
  'movie',
  'tv',
]

/**
 * 拼轮播：按 key 去重，最多 max 张。
 * @param slides 精选来源的几张
 */
export function composeSlides<T extends { key: string }>(
  slides: readonly T[],
  max = HERO_SLIDES
): T[] {
  const seen = new Set<string>()
  return slides
    .filter(slide => !seen.has(slide.key) && seen.add(slide.key))
    .slice(0, max)
}
