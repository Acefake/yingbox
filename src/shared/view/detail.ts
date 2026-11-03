/**
 * 详情、选源、播放地址三个视图（ADR-0030）：view.detail、view.sourcesStart / view.sources、view.resolve。
 */
import { DoubanKindSchema } from './home'
import { type Infer, s } from './schema'

/** 一位演职员 */
export const ViewPersonSchema = s.object('ViewPerson', {
  name: s.string,
  /** 头像缩略图；没有为 null */
  photo: s.nullable(s.string),
})

/** 豆瓣详情 */
export const ViewDetailSchema = s.object('ViewDetail', {
  /** 豆瓣条目 ID */
  id: s.string,
  kind: DoubanKindSchema,
  title: s.string,
  originalTitle: s.string,
  year: s.string,
  /** 「豆瓣 8.0」；没有评分为空串 */
  rating: s.string,
  /** 「剧情 · 喜剧」 */
  genres: s.array(s.string),
  countries: s.array(s.string),
  /** 片长文字（豆瓣原样） */
  duration: s.string,
  directors: s.array(s.string),
  actors: s.array(ViewPersonSchema),
  overview: s.string,
  /** 竖版海报 */
  poster: s.string,
  /** 横版剧照；没有为 null */
  backdrop: s.nullable(s.string),
  /** 剧照缩略图 */
  images: s.array(s.string),
  /** 封面原地址（横版剧照优先，没有用海报）：登记继续观看时交回服务端；都没有为 null */
  coverSource: s.nullable(s.string),
})

/** 一集：解析播放地址、登记继续观看时原样交回服务端 */
export const ViewEpisodeSchema = s.object('ViewEpisode', {
  name: s.string,
  url: s.string,
  /** 插件站点名；CMS 直链为 null */
  siteName: s.nullable(s.string),
  /** 插件参数（JSON 字符串）；CMS 为 null */
  ext: s.nullable(s.string),
})

/** 一条线路 */
export const ViewLineSchema = s.object('ViewLine', {
  label: s.string,
  episodes: s.array(ViewEpisodeSchema),
})

/** 一个站点及其线路 */
export const ViewSourceSiteSchema = s.object('ViewSourceSite', {
  siteName: s.string,
  /** catspider：插件源；cms：苹果 CMS 源 */
  kind: s.enum('SourceKind', ['catspider', 'cms']),
  lines: s.array(ViewLineSchema),
})

/** 选源会话的当前结果：done 之前站点会陆续增加 */
export const ViewSourcesSchema = s.object('ViewSources', {
  sessionId: s.string,
  done: s.boolean,
  /** 插件源在前，再接 CMS 源；同类按找到的先后 */
  sites: s.array(ViewSourceSiteSchema),
})

/** 解析好的播放地址 */
export const ViewPlayableSchema = s.object('ViewPlayable', {
  /** 本服务的播放代理路径（/api/stream?src=…），客户端拼上服务地址、带令牌请求 */
  url: s.string,
  /** 解析结果是否是认得出的媒体直链；false 时多半播不了，客户端可提示换源 */
  direct: s.boolean,
  /** 是否 HLS（m3u8）：代理路径没有后缀，播放器靠它选 HLS 解析 */
  hls: s.boolean,
})

/** 从一条继续观看记录接着播所需的一切（view.resume） */
export const ViewResumeSchema = s.object('ViewResume', {
  continueId: s.string,
  title: s.string,
  /** 继续观看的 key（在线按片名，与桌面一致） */
  key: s.string,
  /** 封面原地址（登记继续观看时原样交回）；没有为 null */
  cover: s.nullable(s.string),
  episodes: s.array(ViewEpisodeSchema),
  /** 当前集在 episodes 里的下标 */
  index: s.number,
  /** 从第几秒开始；下一集或没进度为 0 */
  startAt: s.number,
  /** 打开详情用；不是从豆瓣卡开播的为 null */
  doubanId: s.nullable(s.string),
  kind: s.nullable(DoubanKindSchema),
})

export type ViewPerson = Infer<typeof ViewPersonSchema>
export type ViewDetail = Infer<typeof ViewDetailSchema>
export type ViewEpisode = Infer<typeof ViewEpisodeSchema>
export type ViewLine = Infer<typeof ViewLineSchema>
export type ViewSourceSite = Infer<typeof ViewSourceSiteSchema>
export type ViewSources = Infer<typeof ViewSourcesSchema>
export type ViewPlayable = Infer<typeof ViewPlayableSchema>
export type ViewResume = Infer<typeof ViewResumeSchema>
