/**
 * 弹幕的纯规则：播放条目 → 匹配键与搜索参数、搜索结果挑选、绑定记录的整理与过期、
 * 屏蔽词过滤、设置 → 弹幕插件参数。不依赖 Vue 与 IPC，测试见 tests/danmaku.test.ts。
 */
import type {
  DanmakuAnime,
  DanmakuComment,
} from '../../../../../shared/contract/danmaku'

/** 播放器交给弹幕模块的当前条目 */
export interface DanmakuTarget {
  /** 片名 / 剧名 */
  title: string
  /** 集名（如「第 3 集」「S01E03」）；电影或单文件为空 */
  episode?: string
  /** 播放列表里的第几集（从 1 起）；列表只有一项时不传 */
  index?: number
  /** 本地文件路径（有则先按文件 hash 识别） */
  filePath?: string
}

/** 一条绑定：某个条目（或整部剧）对应的弹幕库 */
export interface DanmakuBinding {
  /** entryKey / seriesKey */
  key: string
  episodeId: number
  animeId: number
  animeTitle: string
  episodeTitle: string
  shift: number
  /** 手动绑定：永久有效，自动匹配不会覆盖 */
  manual: boolean
  savedAt: number
}

/** 自动匹配结果缓存 30 天；手动绑定不过期 */
export const AUTO_MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 绑定记录上限（超出时先丢最旧的自动匹配） */
export const MAX_BINDINGS = 2000

/** 片名归一：小写、去空白和常见标点，用来比较和做键 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\u3000·•:：,，.。!！?？'"“”‘’\-_~～()（）[\]【】《》<>]/g, '')
}

/**
 * 从集名里取集数：S01E03、第3集 / 第03话、EP03 / E03、纯数字「03」。
 * 取不到返回 undefined。
 */
export function parseEpisodeNumber(
  label: string | undefined
): number | undefined {
  const text = (label || '').trim()
  if (!text) return undefined
  const patterns = [
    /s\d{1,2}\s*e(\d{1,4})/i,
    /第\s*(\d{1,4})\s*[集话話期]/,
    /\bep?\s*(\d{1,4})\b/i,
    /^(\d{1,4})$/,
    /^\D{0,6}(\d{1,4})\D{0,6}$/,
  ]
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit) {
      const n = Number(hit[1])
      if (Number.isInteger(n) && n > 0) return n
    }
  }
  return undefined
}

/** 条目的集数：集名里能读出就用它，否则用播放列表序号 */
export function targetEpisodeNumber(target: DanmakuTarget): number | undefined {
  return (
    parseEpisodeNumber(target.episode) ??
    (target.index && target.index > 0 ? target.index : undefined)
  )
}

/** 整部剧的键（在线条目按片名记住手动选过的作品） */
export function seriesKey(title: string): string {
  const norm = normalizeTitle(title)
  return norm ? `series:${norm}` : ''
}

/** 单个条目的键：本地按文件路径，在线按片名 + 集 */
export function entryKey(target: DanmakuTarget): string {
  if (target.filePath) return `file:${target.filePath.replace(/\\/g, '/')}`
  const norm = normalizeTitle(target.title)
  if (!norm) return ''
  const ep = targetEpisodeNumber(target)
  return ep ? `online:${norm}#${ep}` : `online:${norm}`
}

/** 在线搜索参数：作品名 + 集数（字符串） */
export function searchParams(
  target: DanmakuTarget,
  boundTitle?: string
): { anime: string; episode?: string } | null {
  const anime = (boundTitle || target.title).trim()
  if (anime.length < 2) return null
  const ep = targetEpisodeNumber(target)
  return ep ? { anime, episode: String(ep) } : { anime }
}

/** 挑出的作品与集 */
export interface PickedEpisode {
  animeId: number
  animeTitle: string
  episodeId: number
  episodeTitle: string
}

/**
 * 从搜索结果里挑一集：限定作品 id 时只看该作品；否则片名完全相同优先，其次互相包含，最后取第一个。
 * 搜索带了集数时接口已按集过滤，取作品的第一集；没带集数（电影）也取第一集。
 */
export function pickSearchMatch(
  animes: DanmakuAnime[],
  title: string,
  animeId?: number
): PickedEpisode | null {
  const usable = animes.filter(
    anime =>
      anime.episodes.length > 0 && (!animeId || anime.animeId === animeId)
  )
  if (!usable.length) return null
  const want = normalizeTitle(title)
  const score = (anime: DanmakuAnime): number => {
    const have = normalizeTitle(anime.animeTitle)
    if (!want || !have) return 0
    if (have === want) return 3
    if (have.startsWith(want) || want.startsWith(have)) return 2
    if (have.includes(want) || want.includes(have)) return 1
    return 0
  }
  let best = usable[0]
  for (const anime of usable) if (score(anime) > score(best)) best = anime
  const episode = best.episodes[0]
  return {
    animeId: best.animeId,
    animeTitle: best.animeTitle,
    episodeId: episode.episodeId,
    episodeTitle: episode.episodeTitle,
  }
}

/** 绑定是否还能用（手动永久，自动 30 天） */
export function isBindingFresh(
  binding: DanmakuBinding,
  nowMs: number
): boolean {
  return binding.manual || nowMs - binding.savedAt < AUTO_MATCH_TTL_MS
}

/** 校验并整理存储里读出的绑定 */
export function sanitizeBindings(raw: unknown[]): DanmakuBinding[] {
  const out: DanmakuBinding[] = []
  for (const item of raw) {
    const b = (item ?? {}) as Partial<DanmakuBinding>
    if (typeof b.key !== 'string' || !b.key) continue
    if (!Number.isSafeInteger(b.episodeId) || (b.episodeId as number) < 0)
      continue
    out.push({
      key: b.key,
      episodeId: b.episodeId as number,
      animeId: Number.isSafeInteger(b.animeId) ? (b.animeId as number) : 0,
      animeTitle: typeof b.animeTitle === 'string' ? b.animeTitle : '',
      episodeTitle: typeof b.episodeTitle === 'string' ? b.episodeTitle : '',
      shift:
        typeof b.shift === 'number' && Number.isFinite(b.shift) ? b.shift : 0,
      manual: b.manual === true,
      savedAt: typeof b.savedAt === 'number' ? b.savedAt : 0,
    })
  }
  return out
}

/**
 * 写入一条绑定：同键替换；自动匹配不覆盖手动绑定；超出上限时先丢最旧的自动匹配。
 * 返回新列表（不改原数组）。
 */
export function upsertBinding(
  list: DanmakuBinding[],
  next: DanmakuBinding,
  max = MAX_BINDINGS
): DanmakuBinding[] {
  const existing = list.find(b => b.key === next.key)
  if (existing?.manual && !next.manual) return list
  const rest = list.filter(b => b.key !== next.key)
  rest.push(next)
  while (rest.length > max) {
    const autos = rest.filter(b => !b.manual)
    const victim = (autos.length ? autos : rest).reduce((a, b) =>
      a.savedAt <= b.savedAt ? a : b
    )
    rest.splice(rest.indexOf(victim), 1)
  }
  return rest
}

/** 屏蔽规则：普通词按包含匹配（不分大小写），/…/ 包起来的按正则 */
export type BlockRule = string | RegExp

/** 设置里的屏蔽词（每行一个，也接受中英文逗号分隔）→ 规则；非法正则忽略 */
export function parseBlockWords(text: string): BlockRule[] {
  const rules: BlockRule[] = []
  for (const part of text.split(/[\n,，]/)) {
    const word = part.trim()
    if (!word) continue
    const regex = word.match(/^\/(.+)\/([imsu]*)$/)
    if (regex) {
      try {
        rules.push(new RegExp(regex[1], regex[2]))
      } catch {
        // 非法正则不生效
      }
      continue
    }
    rules.push(word.toLowerCase())
  }
  return rules
}

/** 一条弹幕是否被屏蔽 */
export function isBlocked(text: string, rules: BlockRule[]): boolean {
  const lower = text.toLowerCase()
  return rules.some(rule =>
    typeof rule === 'string' ? lower.includes(rule) : rule.test(text)
  )
}

/** 过滤屏蔽词并加上偏移，得到交给插件的弹幕 */
export function prepareComments(
  comments: DanmakuComment[],
  rules: BlockRule[],
  shift = 0
): DanmakuComment[] {
  const out: DanmakuComment[] = []
  for (const c of comments) {
    if (rules.length && isBlocked(c.text, rules)) continue
    const time = c.time + shift
    if (time < 0) continue
    out.push(shift ? { ...c, time } : c)
  }
  return out
}

/** 显示区域 */
export type DanmakuArea = 'quarter' | 'half' | 'full'
/** 速度档位 */
export type DanmakuSpeed = 'slow' | 'normal' | 'fast'

/** 显示区域 → 插件的上下边距（下边距留出的比例即不显示的区域） */
export function areaMargin(area: DanmakuArea): [number, `${number}%` | number] {
  if (area === 'quarter') return [10, '75%']
  if (area === 'full') return [10, 10]
  return [10, '50%']
}

/** 速度档位 → 插件的弹幕停留秒数（越小越快） */
export function speedDuration(speed: DanmakuSpeed): number {
  if (speed === 'slow') return 8
  if (speed === 'fast') return 3.5
  return 5
}

/** 弹幕外观设置 */
export interface DanmakuLook {
  opacity: number
  area: DanmakuArea
  speed: DanmakuSpeed
  fontSize: number
}

/** 外观设置 → 插件配置 */
export function pluginLook(look: DanmakuLook): {
  opacity: number
  margin: [number, `${number}%` | number]
  speed: number
  fontSize: number
} {
  return {
    opacity: Math.min(1, Math.max(0.1, look.opacity)),
    margin: areaMargin(look.area),
    speed: speedDuration(look.speed),
    fontSize: Math.round(Math.min(40, Math.max(14, look.fontSize))),
  }
}
