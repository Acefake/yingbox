/**
 * 「今晚看什么」的候选规则（纯函数，不依赖 Vue / bridge，便于测试）：
 * 心情与时长的定义、条目 → 候选、抽样、按时长与已推荐过滤、发给模型前的精简。
 *
 * 候选只来自普通媒体库（TMDB 来源的电影库 / 剧集库），番号库与私密板块不进来；
 * 读数据见 tonight-source.ts，推荐与兜底见 tonight-picks.ts。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'

/** 心情（可不选） */
export type TonightMood =
  | 'relaxed'
  | 'brainy'
  | 'thrilling'
  | 'healing'
  | 'meal'

/** 可用时长 */
export type TonightTime = 'hour' | 'two' | 'any'

/** 一种心情：标签、发给模型的说明、本地兜底时加分的类型关键词 */
export interface TonightMoodSpec {
  id: TonightMood
  label: string
  /** 本地理由里的「适合……的时候」 */
  phrase: string
  /** 类型关键词（TMDB 中文类型名，附英文以防元数据是英文） */
  genres: readonly string[]
}

export const TONIGHT_MOODS: readonly TonightMoodSpec[] = [
  {
    id: 'relaxed',
    label: '轻松',
    phrase: '想轻松一点',
    genres: ['喜剧', '动画', '家庭', '爱情', '音乐', 'comedy', 'animation'],
  },
  {
    id: 'brainy',
    label: '烧脑',
    phrase: '想动动脑',
    genres: ['悬疑', '科幻', '推理', '犯罪', 'mystery', 'sci-fi', 'science'],
  },
  {
    id: 'thrilling',
    label: '刺激',
    phrase: '想来点刺激',
    genres: ['动作', '冒险', '惊悚', '恐怖', '战争', 'action', 'thriller'],
  },
  {
    id: 'healing',
    label: '治愈',
    phrase: '需要被治愈',
    genres: ['家庭', '动画', '剧情', '爱情', '音乐', '奇幻', 'family', 'drama'],
  },
  {
    id: 'meal',
    label: '下饭',
    phrase: '边吃边看',
    genres: ['喜剧', '动画', '真人秀', '脱口秀', '犯罪', 'comedy', 'reality'],
  },
]

/** 可用时长：上限分钟数（不限为 null） */
export const TONIGHT_TIMES: readonly {
  id: TonightTime
  label: string
  minutes: number | null
}[] = [
  { id: 'hour', label: '1 小时内', minutes: 60 },
  { id: 'two', label: '2 小时', minutes: 120 },
  { id: 'any', label: '不限', minutes: null },
]

export const moodSpec = (mood: TonightMood | null): TonightMoodSpec | null =>
  TONIGHT_MOODS.find(m => m.id === mood) ?? null

/** 一个候选：海报墙条目 + 今晚要占用的时长 */
export interface TonightCandidate {
  /** 媒体库条目 id（电影 / 剧） */
  id: number
  kind: 'movie' | 'series'
  title: string
  year: number | null
  genres: string[]
  rating: number | null
  /** 今晚要花的分钟数：电影是剩余时长，剧是一集的时长；未知为 null */
  minutes: number | null
  overview: string
  backdrop: string | null
  poster: string | null
  /** 在「继续播放」里时的记录 id（在看的剧 / 看了一半的电影） */
  continueId?: string
  /** 在看的剧当前集名 */
  episode?: string
}

/** 「继续播放」记录里候选需要的部分 */
export interface TonightProgress {
  id: string
  /** 已播秒数 */
  progress: number
  /** 当前集 / 片的总秒数；未知为 0 */
  duration: number
  episode?: string
  nextUp?: boolean
}

/** 播到这个比例算看完（与继续播放一致） */
const WATCHED_RATIO = 0.95
/** 精简后简介最多几个字 */
export const OVERVIEW_CHARS = 80
/** 最多发给模型多少条候选 */
export const CANDIDATE_LIMIT = 80

const hasVideo = (node: LibraryItemNode): boolean =>
  node.files.some(file => file.kind === 'video')

function base(
  node: LibraryItemNode
): Omit<TonightCandidate, 'kind' | 'minutes'> {
  return {
    id: node.id,
    title: node.title,
    year: node.year,
    genres: node.genres.slice(0, 4),
    rating: node.rating,
    overview: (node.overview ?? '').trim(),
    backdrop: node.backdrop,
    poster: node.poster,
  }
}

/**
 * 电影 → 候选。看完的（继续播放里没有，且记下的进度已到片尾）和没有视频文件的返回 null。
 *
 * @param watchedSeconds 播放进度表里这部片的已播秒数（没有记 0）
 * @param record 继续播放里的记录（看了一半）
 */
export function movieCandidate(
  node: LibraryItemNode,
  watchedSeconds: number,
  record?: TonightProgress
): TonightCandidate | null {
  if (node.type !== 'movie' || !hasVideo(node)) return null
  const runtime = node.runtime && node.runtime > 0 ? node.runtime : null
  if (!record && runtime && watchedSeconds >= runtime * 60 * WATCHED_RATIO)
    return null
  let minutes = runtime
  if (record) {
    const total = record.duration > 0 ? record.duration / 60 : runtime
    minutes = total
      ? Math.max(1, Math.round(total - record.progress / 60))
      : null
  }
  return {
    ...base(node),
    kind: 'movie',
    minutes,
    ...(record ? { continueId: record.id } : {}),
  }
}

/** 一集的时长：剧本身的 runtime，没有就取第一集有 runtime 的 */
export function episodeMinutes(node: LibraryItemNode): number | null {
  if (node.runtime && node.runtime > 0) return node.runtime
  for (const child of node.children) {
    const found = episodeMinutes(child)
    if (found) return found
  }
  return null
}

/** 在看的剧 → 候选（时长按一集算，当前集看了一半时算剩余） */
export function seriesCandidate(
  node: LibraryItemNode,
  record: TonightProgress
): TonightCandidate | null {
  if (node.type !== 'series') return null
  const episode = episodeMinutes(node)
  const playing = !record.nextUp && record.duration > 0
  const minutes = playing
    ? Math.max(1, Math.round((record.duration - record.progress) / 60))
    : episode
  return {
    ...base(node),
    kind: 'series',
    minutes,
    continueId: record.id,
    ...(record.episode ? { episode: record.episode } : {}),
  }
}

/**
 * 要取详情的电影：评分靠前的占七成，其余从剩下的里随机抽，免得每次都是同一批。
 *
 * @param items 已按评分降序的条目
 * @param random 0–1 随机数（测试可注入）
 */
export function samplePool<T>(
  items: readonly T[],
  size: number,
  random: () => number = Math.random
): T[] {
  if (items.length <= size) return [...items]
  const top = Math.ceil(size * 0.7)
  const rest = items.slice(top)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [...items.slice(0, top), ...rest.slice(0, size - top)]
}

/** 时长是否放得下（未知时长只在「不限」时算放得下） */
export function fitsTime(minutes: number | null, time: TonightTime): boolean {
  const limit = TONIGHT_TIMES.find(t => t.id === time)?.minutes ?? null
  if (limit === null) return true
  return minutes !== null && minutes <= limit
}

/**
 * 按时长过滤、去掉已推荐过的，在看的排前面、其余按评分，最多 limit 条。
 */
export function selectCandidates(
  candidates: readonly TonightCandidate[],
  options: { time: TonightTime; exclude?: ReadonlySet<number> },
  limit = CANDIDATE_LIMIT
): TonightCandidate[] {
  const exclude = options.exclude ?? new Set<number>()
  return candidates
    .filter(c => !exclude.has(c.id) && fitsTime(c.minutes, options.time))
    .sort(
      (a, b) =>
        Number(Boolean(b.continueId)) - Number(Boolean(a.continueId)) ||
        (b.rating ?? 0) - (a.rating ?? 0)
    )
    .slice(0, limit)
}

/** 发给模型的一条候选 */
export interface CompactCandidate {
  id: number
  title: string
  year: number | null
  type: '电影' | '剧集'
  genres: string[]
  rating: number | null
  minutes: number | null
  overview: string
  /** 在看（剧） / 看了一半（电影） */
  watching?: true
}

/** 截前 n 个字（按字符，不切坏 emoji / 生僻字） */
export function clip(text: string, chars: number): string {
  const list = Array.from(text.replace(/\s+/g, ' ').trim())
  return list.slice(0, chars).join('')
}

/** 精简：只留模型挑片需要的字段，简介截前 80 字 */
export function compactCandidate(c: TonightCandidate): CompactCandidate {
  return {
    id: c.id,
    title: c.title,
    year: c.year,
    type: c.kind === 'movie' ? '电影' : '剧集',
    genres: c.genres,
    rating: c.rating === null ? null : Math.round(c.rating * 10) / 10,
    minutes: c.minutes,
    overview: clip(c.overview, OVERVIEW_CHARS),
    ...(c.continueId ? { watching: true as const } : {}),
  }
}

/** 卡片上的一行信息：时长 · 年份 · 评分 · 在看到哪 */
export function candidateMeta(c: TonightCandidate): string {
  const minutes = c.minutes ? `${c.minutes} 分钟` : ''
  const time = !minutes
    ? ''
    : c.kind === 'series'
      ? `一集 ${minutes}`
      : c.continueId
        ? `剩 ${minutes}`
        : minutes
  return [
    time,
    c.year ? String(c.year) : '',
    c.rating ? `评分 ${c.rating.toFixed(1)}` : '',
    c.kind === 'series' ? (c.episode ? `在看 ${c.episode}` : '在看') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
