/**
 * 快捷标签 → 豆瓣 rexxar 接口参数。
 *
 * 旧的 movie.douban.com/j/search_subjects 现在一律 302 到 sec.douban.com 验证页，首页因此整片加载失败；
 * 这里全部改走 m.douban.com/rexxar（豆瓣「选电影 / 选剧集」页同一套接口，只要 Referer）：
 * - 「最近热门」类标签：/subject/recent_hot/<movie|tv>?category&type（豆瓣首页热门榜）；
 * - 其余类型 / 地区标签：/<movie|tv>/recommend，等同于在筛选面板里选了该项。
 */
import type { DoubanKind, DoubanSort } from '../../shared/douban/query'

/** 一个快捷标签对应的取数方式 */
export type QuickSource =
  | { api: 'recent_hot'; category: string; type: string }
  | {
      api: 'recommend'
      tags: string
      categories: Record<string, string>
      sort: DoubanSort
    }

const hot = (category: string, type: string): QuickSource => ({
  api: 'recent_hot',
  category,
  type,
})

const pick = (
  tags: string,
  categories: Record<string, string> = {},
  sort: DoubanSort = 'U'
): QuickSource => ({ api: 'recommend', tags, categories, sort })

const genre = (name: string): QuickSource => pick(name, { 类型: name })
const region = (name: string): QuickSource => pick(name, { 地区: name }, 'T')

/** 与 shared/douban/query.ts 的 QUICK_TAGS 一一对应（测试保证没有遗漏） */
export const QUICK_SOURCES: Record<DoubanKind, Record<string, QuickSource>> = {
  movie: {
    热门: hot('热门', '全部'),
    最新: hot('最新', '全部'),
    经典: pick('经典'),
    豆瓣高分: hot('豆瓣高分', '全部'),
    冷门佳片: hot('冷门佳片', '全部'),
    华语: hot('热门', '华语'),
    欧美: hot('热门', '欧美'),
    韩国: hot('热门', '韩国'),
    日本: hot('热门', '日本'),
    动作: genre('动作'),
    喜剧: genre('喜剧'),
    爱情: genre('爱情'),
    科幻: genre('科幻'),
    悬疑: genre('悬疑'),
    恐怖: genre('恐怖'),
  },
  tv: {
    热门: hot('tv', 'tv'),
    美剧: hot('tv', 'tv_american'),
    // recent_hot 的 tv_british / tv_hongkong 会退回全部剧集，改用地区筛选
    英剧: region('英国'),
    韩剧: hot('tv', 'tv_korean'),
    日剧: hot('tv', 'tv_japanese'),
    国产剧: hot('tv', 'tv_domestic'),
    港剧: region('中国香港'),
    日本动画: hot('tv', 'tv_animation'),
    综艺: hot('show', 'show'),
    纪录片: hot('tv', 'tv_documentary'),
  },
}

/** 取快捷标签的取数方式；白名单外的标签按「热门」处理 */
export const quickSource = (kind: DoubanKind, tag: string): QuickSource =>
  QUICK_SOURCES[kind][tag] ?? QUICK_SOURCES[kind]['热门']
