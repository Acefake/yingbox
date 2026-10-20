/**
 * 黄金测试集的数据形状。
 *
 * 期望值只描述“一个正确的解析器应当给出的结果”，不依赖任何解析实现。
 */

/** 外部 ID，统一用字符串保存（imdb 带 tt 前缀）。 */
export interface GoldenIds {
  tmdb?: string
  imdb?: string
  tvdb?: string
}

/** 单条用例的期望解析结果。 */
export interface GoldenExpected {
  type: 'movie' | 'episode' | 'extra'
  title: string
  altTitle?: string
  year?: number
  season?: number
  episodes?: number[]
  /** 动画绝对集数（无季信息、按总集数编号）。 */
  absolute?: boolean
  /** 分段序号（CD1 / part2 / disc1）。 */
  part?: number
  /** 日播节目的播出日期，YYYY-MM-DD。 */
  airDate?: string
  ids?: GoldenIds
}

/** 用例分类，用于逐类统计准确率。 */
export type GoldenCategory =
  | 'movie-scene'
  | 'movie-dual-title'
  | 'movie-cjk'
  | 'movie-bracket-year'
  | 'movie-folder-fallback'
  | 'movie-disc'
  | 'movie-part'
  | 'movie-ids'
  | 'episode-sxxexx'
  | 'episode-multi'
  | 'episode-1x01'
  | 'episode-cjk'
  | 'episode-ep'
  | 'episode-folder'
  | 'episode-anime-absolute'
  | 'episode-special'
  | 'episode-date'
  | 'episode-ids'
  | 'extra'

/** 一条黄金用例：完整路径（含父文件夹）+ 期望值。 */
export interface GoldenCase {
  path: string
  category: GoldenCategory
  expected: GoldenExpected
  /** 手写难例为 true；规则生成的为 false。 */
  hand: boolean
}
