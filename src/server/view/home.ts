/**
 * view.home 里豆瓣那部分的拼装（ADR-0030）：用与桌面首页相同的共享规则取数、补全，再换成视图卡。
 * 每一行独立取数，失败的行省略，不让整个首页失败。
 */
import { pickChart } from '../../shared/douban/chart'
import {
  COLLECTIONS,
  HOME_GENRES,
  collectionQuery,
} from '../../shared/douban/collections'
import {
  type DoubanEnrichDeps,
  type DoubanItem,
  doubanItemOf,
  doubanSubjectId,
  enrichDoubanItems,
} from '../../shared/douban/item'
import {
  type DoubanKind,
  type DoubanPage,
  type DoubanQuery,
  type DoubanSubject,
  defaultDoubanQuery,
} from '../../shared/douban/query'
import { enrichFromTmdb } from '../../shared/douban/tmdb-enrich'
import type { ThumbWidth } from '../../shared/media-url'
import type {
  HomeFeed,
  ViewCard,
  ViewCollection,
  ViewShelf,
} from '../../shared/view/home'

/** 首页取数 */
export interface HomeDeps extends DoubanEnrichDeps {
  /** 豆瓣浏览一页（online.doubanBrowse） */
  browse: (query: DoubanQuery, start: number) => Promise<DoubanPage>
  /** 一周口碑榜（online.doubanChart） */
  chart: () => Promise<DoubanSubject[]>
}

/** 片单卡背景取前几部的海报 */
const COLLECTION_POSTERS = 3

/** 海报 480（电视上一张卡约 260 物理像素宽，留余量），剧照用最大档 780 */
const POSTER_WIDTH: ThumbWidth = 480
const BACKDROP_WIDTH: ThumbWidth = 780

/** 远程图片 → 本服务缩略图路径（防盗链 Referer 由 /media/thumb 补；宽度只能是 THUMB_WIDTHS 的档位） */
export const thumbPath = (src: string, width: ThumbWidth): string =>
  `/media/thumb?w=${width}&src=${encodeURIComponent(src)}`

/** 补全后的豆瓣卡 → 视图卡 */
export function viewCardOf(item: DoubanItem, kind: DoubanKind): ViewCard {
  const poster = item.cover || item.coverSrc
  return {
    id: doubanSubjectId(item.url) ?? item.url,
    title: item.title,
    searchTitle: item.searchTitle || item.title,
    year: item.year,
    rate: item.rate === '暂无' ? '' : item.rate,
    kind: item.kind ?? kind,
    poster: poster ? thumbPath(poster, POSTER_WIDTH) : '',
    backdrop: item.backdrop ? thumbPath(item.backdrop, BACKDROP_WIDTH) : null,
    overview: item.overview,
    doubanUrl: item.url,
  }
}

/** 同一部只留第一次出现的（豆瓣分页偶有重复；客户端按 id 作列表 key） */
function uniqueById(cards: ViewCard[]): ViewCard[] {
  const seen = new Set<string>()
  return cards.filter(card => !seen.has(card.id) && seen.add(card.id))
}

/** 一批豆瓣条目 → 补全后的视图卡（前五项补豆瓣详情，再用 TMDB 补海报，与桌面首页相同） */
async function cardsOf(
  subjects: readonly DoubanSubject[],
  kind: DoubanKind,
  deps: HomeDeps
): Promise<ViewCard[]> {
  const items = subjects.map(doubanItemOf)
  await enrichDoubanItems(items, kind, deps)
  return uniqueById(items.map(item => viewCardOf(item, kind)))
}

async function hotShelf(
  kind: DoubanKind,
  deps: HomeDeps
): Promise<ViewShelf | null> {
  const page = await deps.browse(defaultDoubanQuery(kind), 0)
  if (!page.items.length) return null
  return {
    title: kind === 'tv' ? '热门剧集' : '热门电影',
    kind,
    items: await cardsOf(page.items, kind, deps),
  }
}

async function chartShelf(deps: HomeDeps): Promise<ViewShelf | null> {
  const weekly = await deps.chart().catch(() => null)
  const hot = weekly?.length
    ? null
    : await deps
        .browse(defaultDoubanQuery('movie'), 0)
        .then(page => page.items)
        .catch(() => null)
  const chart = pickChart(weekly, hot)
  if (!chart) return null
  return {
    title: chart.title,
    kind: 'movie',
    items: await cardsOf(chart.items, 'movie', deps),
  }
}

/** 片单卡背景只要海报：只用 TMDB 补，不取豆瓣详情（首页冷启动少十几个请求） */
async function collectionPosters(
  query: DoubanQuery,
  kind: DoubanKind,
  deps: HomeDeps
): Promise<string[]> {
  try {
    const page = await deps.browse(query, 0)
    const items = page.items.slice(0, COLLECTION_POSTERS).map(doubanItemOf)
    await enrichFromTmdb(items, kind, deps.search)
    return items.map(item => viewCardOf(item, kind).poster).filter(Boolean)
  } catch {
    return []
  }
}

async function collectionCards(deps: HomeDeps): Promise<ViewCollection[]> {
  return Promise.all(
    COLLECTIONS.map(async c => {
      const posters = await collectionPosters(collectionQuery(c), c.kind, deps)
      return {
        id: c.id,
        kicker: c.kicker,
        title: c.title,
        blurb: c.blurb,
        kind: c.kind,
        posters,
      }
    })
  )
}

/** 首页三行卡片是否都取到了（有缺行时缓存时间短，好让网络恢复后很快补上） */
export const isCompleteHome = (home: HomeFeed): boolean =>
  Boolean(home.hotMovies && home.hotTv && home.chart)

/** 拼首页里可缓存的部分（继续观看与轮播见 compose.ts）；某行失败只省略那一行 */
export async function buildHomeFeed(deps: HomeDeps): Promise<HomeFeed> {
  const orNull = <T>(work: Promise<T | null>): Promise<T | null> =>
    work.catch(() => null)
  const [hotMovies, hotTv, chart, collections] = await Promise.all([
    orNull(hotShelf('movie', deps)),
    orNull(hotShelf('tv', deps)),
    orNull(chartShelf(deps)),
    collectionCards(deps),
  ])
  return { hotMovies, hotTv, chart, genres: [...HOME_GENRES], collections }
}
