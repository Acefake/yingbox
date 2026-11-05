/**
 * 首页里依赖播放记录的继续观看行，与轮播（Hero，只放精选，继续观看不进轮播）。每次请求用最新的记录现拼，
 * 选片规则与桌面首页相同（shared/playback/hero-rules.ts、continue-rules.ts）。
 */
import type { DoubanItem } from '../../shared/douban/item'
import type { DoubanKind } from '../../shared/douban/query'
import { mapWithConcurrency } from '../../shared/concurrency'
import { asRecord, asText } from '../../shared/json'
import { formatRating } from '../../shared/library/rating'
import { isThumbSource } from '../../shared/media-url'
import {
  type ContinueRecord,
  footOf,
  progressRatio,
  recordsFor,
  subtitleOf,
} from '../../shared/playback/continue-rules'
import { HOME_SECTIONS, composeSlides } from '../../shared/playback/hero-rules'
import type {
  HomeFeed,
  HomeView,
  ViewCard,
  ViewContinue,
  ViewHeroSlide,
} from '../../shared/view/home'
import { thumbPath, viewCardOf } from './home'

/** 记录里的封面（客户端交来的任意地址）→ 缩略图路径；不能做缩略图的为 null */
const coverOf = (record: ContinueRecord): string | null =>
  record.cover && isThumbSource(record.cover)
    ? thumbPath(record.cover, 780)
    : null

function continueCard(record: ContinueRecord, now: number): ViewContinue {
  return {
    id: record.id,
    section: record.section,
    title: record.title,
    subtitle: subtitleOf(record, now),
    foot: footOf(record),
    image: coverOf(record),
    poster: null,
    progress: progressRatio(record),
  }
}

function doubanSlide(card: ViewCard): ViewHeroSlide {
  return {
    key: `douban:${card.doubanUrl}`,
    kind: 'douban',
    kicker: '豆瓣 · 热门电影',
    title: card.title,
    image: card.backdrop ?? card.poster,
    imageIsPoster: !card.backdrop,
    overview: card.overview,
    meta: [card.year ? `${card.year} 年` : '', '电影']
      .filter(Boolean)
      .join(' · '),
    rating: formatRating(Number(card.rate), 'douban'),
    logo: card.logo,
    playLabel: '播放',
    continueId: null,
    cardId: card.id,
  }
}

/** 收藏的豆瓣卡 → 视图卡（旧收藏可能没有 kind：按「剧集 / 电影」文字判断） */
export const favoriteCards = (items: readonly DoubanItem[]): ViewCard[] =>
  items.map(item =>
    viewCardOf(item, item.kind ?? (item.type === '剧集' ? 'tv' : 'movie'))
  )

/** 记录详情里的豆瓣身份（安卓开播时写入 { doubanId, kind }）；没有为 null */
function doubanRefOf(
  record: ContinueRecord
): { id: string; kind: DoubanKind } | null {
  const detail = asRecord(record.detail)
  const id = asText(detail?.doubanId)
  const kind =
    detail?.kind === 'tv' ? 'tv' : detail?.kind === 'movie' ? 'movie' : null
  return id && kind ? { id, kind } : null
}

/**
 * 「最近播放」整页：首页板块里的全部继续观看记录（首页那一行只取前 12）。
 * 在线记录按豆瓣 ID 补竖版海报（posterOf 取不到返回 null，客户端退回横版封面）。
 */
export const recentCards = async (
  records: readonly ContinueRecord[],
  now: number,
  posterOf: (id: string, kind: DoubanKind) => Promise<string | null>
): Promise<ViewContinue[]> => {
  const cards = records
    .filter(record => HOME_SECTIONS.includes(record.section))
    .map(record => ({ record, ref: doubanRefOf(record) }))
  // 同一部片多条记录只取一次；最多 4 个并发，单个最多等 POSTER_TIMEOUT_MS
  const refs = [
    ...new Map(
      cards.flatMap(({ ref }) =>
        ref ? [[`${ref.kind}:${ref.id}`, ref] as const] : []
      )
    ).entries(),
  ]
  const posters = new Map<string, string | null>()
  await mapWithConcurrency(refs, 4, async ([key, ref]) => {
    posters.set(
      key,
      await withTimeout(posterOf(ref.id, ref.kind), POSTER_TIMEOUT_MS).catch(
        () => null
      )
    )
  })
  return cards.map(({ record, ref }) => ({
    ...continueCard(record, now),
    poster: ref ? (posters.get(`${ref.kind}:${ref.id}`) ?? null) : null,
  }))
}

/** 单张海报最多等多久（毫秒） */
const POSTER_TIMEOUT_MS = 5_000

/** promise 超时即当作失败 */
const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('超时')), ms).unref?.()
    ),
  ])

/** 首页收藏行最多几部（新收藏在前） */
const FAVORITES_ROW = 30

/** 缓存的首页数据 + 最新的继续观看与收藏 → 完整首页 */
export function composeHome(
  feed: HomeFeed,
  records: readonly ContinueRecord[],
  favorites: readonly DoubanItem[],
  now: number
): HomeView {
  const featured = (feed.hotMovies?.items ?? [])
    .filter(card => card.backdrop || card.poster)
    .map(doubanSlide)
  return {
    hero: composeSlides(featured),
    continueRow: recordsFor(records, HOME_SECTIONS).map(record =>
      continueCard(record, now)
    ),
    favorites: favoriteCards(favorites.slice(0, FAVORITES_ROW)),
    ...feed,
  }
}
