/**
 * 首页视图 view.home 的结果（ADR-0030 决策 6）：轮播、继续观看、热门货架、榜单、按类型浏览、精选片单。
 * 继续观看与收藏来自服务端播放记录（ADR-0031），每次请求现读；其余部分缓存。
 *
 * 图片字段是本服务的缩略图路径（/media/thumb?w=&src=），客户端拼上服务地址、带令牌请求。
 */
import { type Infer, s } from './schema'

export const DoubanKindSchema = s.enum('DoubanKind', ['movie', 'tv'])

/** 一张豆瓣卡 */
export const ViewCardSchema = s.object('ViewCard', {
  /** 豆瓣条目 ID；地址不是豆瓣条目时为原地址 */
  id: s.string,
  title: s.string,
  /** 搜源用的片名（TMDB 找到条目时是 TMDB 的中文名） */
  searchTitle: s.string,
  year: s.string,
  /** 豆瓣评分文字；无评分为空串 */
  rate: s.string,
  kind: DoubanKindSchema,
  /** 竖版海报 */
  poster: s.string,
  /** 横版剧照；没有为 null */
  backdrop: s.nullable(s.string),
  /** 简介；只有首屏几张补全过，其余为空串 */
  overview: s.string,
  /** movie.douban.com/subject/<id>/ */
  doubanUrl: s.string,
  /** 片名标志图（透明底 PNG，TMDB）；只有首页轮播那几张去取，没有为 null */
  logo: s.nullable(s.string),
})

/** 一行卡片：热门货架或榜单 */
export const ViewShelfSchema = s.object('ViewShelf', {
  title: s.string,
  kind: DoubanKindSchema,
  items: s.array(ViewCardSchema),
})

/** 精选片单的一张卡 */
export const ViewCollectionSchema = s.object('ViewCollection', {
  id: s.enum('CollectionId', ['top', 'gems', 'chinese', 'kdrama']),
  /** 左上角英文小标签 */
  kicker: s.string,
  title: s.string,
  blurb: s.string,
  kind: DoubanKindSchema,
  /** 片单前几部的海报（扇形背景）；取不到为空 */
  posters: s.array(s.string),
})

/** 继续观看的一张卡 */
export const ViewContinueSchema = s.object('ViewContinue', {
  /** 记录 id（section:key），继续播放、移除时交回服务端 */
  id: s.string,
  section: s.enum('ContinueSection', ['movie', 'tv', 'jav', 'online', 'av']),
  title: s.string,
  /** 第二行：集名，或「上一集已看完 · 上次 昨天」（与桌面卡片相同） */
  subtitle: s.string,
  /** 第三行：「剩余 18 分钟」「播放下一集」「继续播放」 */
  foot: s.string,
  /** 横版封面；没有为 null */
  image: s.nullable(s.string),
  /** 竖版海报：只有最近播放页会解析（在线记录按豆瓣 ID 取），其余、取不到为 null */
  poster: s.nullable(s.string),
  /** 已播比例 0–1；下一集或时长未知为 0 */
  progress: s.number,
})

/** 轮播的一张 */
export const ViewHeroSlideSchema = s.object('ViewHeroSlide', {
  /** 去重键 */
  key: s.string,
  /** resume：继续观看那一张；douban：豆瓣热门 */
  kind: s.enum('HeroKind', ['resume', 'douban']),
  /** 标签行：「在线 · 第 14 集 · 看到 40%」「豆瓣 · 热门电影」 */
  kicker: s.string,
  title: s.string,
  /** 背景图（横版剧照；没有剧照时是海报，见 imageIsPoster） */
  image: s.string,
  imageIsPoster: s.boolean,
  overview: s.string,
  /** 「2026 年 · 电影」 */
  meta: s.string,
  /** 评分文字；没有为空串 */
  rating: s.string,
  /** 片名标志图（透明底 PNG）；有就代替文字标题，没有为 null */
  logo: s.nullable(s.string),
  /** 主按钮：「继续播放 · 剩 48 分钟」「播放」 */
  playLabel: s.string,
  /** resume 那一张对应的继续观看记录 id */
  continueId: s.nullable(s.string),
  /** douban 那几张对应的卡 id */
  cardId: s.nullable(s.string),
})

/** 首页 */
export const HomeViewSchema = s.object('HomeView', {
  /** 轮播：继续观看在前，再接豆瓣热门，最多 5 张；没有可放的为空 */
  hero: s.array(ViewHeroSlideSchema),
  /** 继续观看（首页合并的板块，最近的在前）；没有为空 */
  continueRow: s.array(ViewContinueSchema),
  /** 我的收藏（新收藏在前）；没有为空 */
  favorites: s.array(ViewCardSchema),
  /** 热门电影；取不到为 null（整行隐藏） */
  hotMovies: s.nullable(ViewShelfSchema),
  hotTv: s.nullable(ViewShelfSchema),
  /** 口碑榜，取不到时是热门电影前 10；两路都没有为 null */
  chart: s.nullable(ViewShelfSchema),
  /** 按类型浏览的类型名 */
  genres: s.array(s.string),
  collections: s.array(ViewCollectionSchema),
})

export type ViewCard = Infer<typeof ViewCardSchema>
export type ViewShelf = Infer<typeof ViewShelfSchema>
export type ViewCollection = Infer<typeof ViewCollectionSchema>
export type ViewContinue = Infer<typeof ViewContinueSchema>
export type ViewHeroSlide = Infer<typeof ViewHeroSlideSchema>
export type HomeView = Infer<typeof HomeViewSchema>

/** 首页里不依赖播放记录、可以缓存的部分 */
export type HomeFeed = Omit<HomeView, 'hero' | 'continueRow' | 'favorites'>
