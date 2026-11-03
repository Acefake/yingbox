/**
 * 首页里依赖播放记录的两块：轮播（Hero）与继续观看行。每次请求用最新的记录现拼，
 * 选片与文案规则与桌面首页相同（shared/playback/hero-rules.ts、continue-rules.ts）。
 */
import type { DoubanItem } from '../../shared/douban/item'
import { formatRating } from '../../shared/library/rating'
import { isThumbSource } from '../../shared/media-url'
import {
  type ContinueRecord,
  footOf,
  progressRatio,
  recordsFor,
  subtitleOf,
} from '../../shared/playback/continue-rules'
import {
  HOME_SECTIONS,
  composeSlides,
  pickResumeRecord,
  resumeKicker,
  resumePlayLabel,
} from '../../shared/playback/hero-rules'
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
    progress: progressRatio(record),
  }
}

function resumeSlide(record: ContinueRecord): ViewHeroSlide | null {
  const image = coverOf(record)
  if (!image) return null
  return {
    key: `continue:${record.id}`,
    kind: 'resume',
    kicker: resumeKicker(record),
    title: record.title,
    image,
    imageIsPoster: false,
    overview: '',
    meta: '',
    rating: '',
    playLabel: resumePlayLabel(record),
    continueId: record.id,
    cardId: null,
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
    playLabel: '选源播放',
    continueId: null,
    cardId: card.id,
  }
}

/** 首页收藏行最多几部（新收藏在前） */
const FAVORITES_ROW = 30

/** 缓存的首页数据 + 最新的继续观看与收藏 → 完整首页 */
export function composeHome(
  feed: HomeFeed,
  records: readonly ContinueRecord[],
  favorites: readonly DoubanItem[],
  now: number
): HomeView {
  // 只从能做缩略图的记录里挑：选中了却放不出图，会把更早、有图的那条也挤掉
  const resume = pickResumeRecord(records.filter(record => coverOf(record)))
  const featured = (feed.hotMovies?.items ?? [])
    .filter(card => card.backdrop || card.poster)
    .map(doubanSlide)
  return {
    hero: composeSlides(resume ? resumeSlide(resume) : null, featured),
    continueRow: recordsFor(records, HOME_SECTIONS).map(record =>
      continueCard(record, now)
    ),
    favorites: favorites.slice(0, FAVORITES_ROW).map(item =>
      // 旧收藏可能没有 kind：按「剧集 / 电影」文字判断
      viewCardOf(item, item.kind ?? (item.type === '剧集' ? 'tv' : 'movie'))
    ),
    ...feed,
  }
}
