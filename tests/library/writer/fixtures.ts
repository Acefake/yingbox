/**
 * 写出层测试的元数据样例：中文、繁体、特殊字符（& < > 引号、控制字符、emoji）都覆盖到。
 */
import type {
  EpisodeMetadata,
  MediaMetadata,
  SeasonMetadata,
} from '../../../src/shared/library/provider'

/** 电影：带合集、分级、编剧、演员头像。 */
export const MOVIE: MediaMetadata = {
  ref: { provider: 'tmdb', kind: 'movie', id: '535167' },
  title: '流浪地球 & <特别版>',
  originalTitle: 'The Wandering Earth "Director\'s Cut"',
  originalLanguage: 'zh',
  year: 2019,
  releaseDate: '2019-02-05',
  overview: '太阳即将毁灭，人类开启“流浪地球”计划。\u0007控制字符应被去掉 🌍',
  overviewLanguage: 'zh-CN',
  tagline: '希望是像钻石一样珍贵的东西',
  genres: ['科幻', '冒险'],
  rating: 7.512,
  voteCount: 1234,
  runtimeMinutes: 125,
  countries: ['CN', 'US'],
  companies: ['中国电影股份有限公司', 'Bona Film Group'],
  certification: 'PG-13',
  cast: [
    {
      id: '78871',
      name: '吴京',
      character: '刘培强',
      order: 0,
      profilePath: '/wujing.jpg',
    },
    { id: '1192', name: 'Qu Chuxiao', character: 'Liu Qi', order: 1 },
  ],
  crew: [
    { id: '1', name: '郭帆', job: 'Director' },
    { id: '2', name: '龚格尔', job: 'Screenplay' },
    { id: '3', name: '刘慈欣', job: 'Novel' },
    { id: '4', name: '某制片', job: 'Producer' },
  ],
  images: [
    {
      role: 'poster',
      path: '/poster-zh.jpg',
      language: 'zh',
      width: 2000,
      height: 3000,
      voteAverage: 5,
      voteCount: 3,
    },
    {
      role: 'backdrop',
      path: '/backdrop.jpg',
      language: null,
      width: 3840,
      height: 2160,
      voteAverage: 5,
      voteCount: 3,
    },
    {
      role: 'logo',
      path: '/logo.svg',
      language: 'zh',
      width: 800,
      height: 300,
      voteAverage: 5,
      voteCount: 3,
    },
    {
      role: 'logo',
      path: '/logo.png',
      language: 'zh',
      width: 800,
      height: 300,
      voteAverage: 5,
      voteCount: 2,
    },
  ],
  externalIds: { tmdb: '535167', imdb: 'tt7605074' },
  status: 'Released',
  collection: { id: '1000', name: '流浪地球（系列）' },
}

/** 剧集。 */
export const SERIES: MediaMetadata = {
  ref: { provider: 'tmdb', kind: 'tv', id: '64010' },
  title: '請回答1988',
  originalTitle: '응답하라 1988',
  year: 2015,
  releaseDate: '2015-11-06',
  overview: '1988 年首尔双门洞五户人家的故事。',
  genres: ['剧情', '喜剧'],
  rating: 8.6,
  voteCount: 500,
  runtimeMinutes: 90,
  countries: ['KR'],
  companies: ['tvN'],
  certification: '15',
  cast: [{ id: '10', name: '李惠利', character: '成德善', order: 0 }],
  crew: [{ id: '11', name: '申元浩', job: 'Creator' }],
  images: [],
  externalIds: { tmdb: '64010', imdb: 'tt5182866', tvdb: '299945' },
  status: 'Ended',
  seasons: [
    { season: 0, name: '特别篇', episodeCount: 1 },
    { season: 1, name: '第 1 季', episodeCount: 20 },
  ],
}

/** 第 1 季。 */
export const SEASON: Omit<SeasonMetadata, 'episodes'> = {
  season: 1,
  name: '第 1 季',
  overview: '<双门洞>的一年',
  airDate: '2015-11-06',
  posterPath: '/s1.jpg',
}

/** 两集（用来测一个文件含多集）。 */
export const EPISODES: EpisodeMetadata[] = [
  {
    season: 1,
    episode: 5,
    title: '再见，初恋 & 你好',
    overview: '德善的"初恋"。',
    airDate: '2015-11-20',
    runtimeMinutes: 95,
    rating: 8.9,
    stillPath: '/e5.jpg',
  },
  { season: 1, episode: 6, title: '母亲们', airDate: '2015-11-21' },
]
