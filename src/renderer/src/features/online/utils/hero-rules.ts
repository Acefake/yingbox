/**
 * 首页 Hero 选片的纯规则：有没看完的片子时第一张放它（标签行写来源与进度，主按钮写剩余时间），
 * 后面接精选来源（片库新入库 / 豆瓣热门），同一部只出现一次，最多 HERO_SLIDES 张。
 *
 * 不依赖 Vue；继续观看记录的形状见 features/player 的 continue-rules。
 */
import type { ContinueRecord, ContinueSection } from '@/features/player'

/** 轮播最多几页 */
export const HERO_SLIDES = 5

/** 首页的继续观看合并的板块：在线与片库电影、剧集 */
export const HOME_SECTIONS: readonly ContinueSection[] = [
  'online',
  'movie',
  'tv',
]

/** 片库记录里的条目 id（detail 是 { itemId }）；不是片库记录或没有时为 null */
export function libraryItemIdOf(record: ContinueRecord): number | null {
  if (record.section !== 'movie' && record.section !== 'tv') return null
  const id = (record.detail as { itemId?: unknown } | undefined)?.itemId
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

/**
 * Hero 第一张要放的继续观看记录：首页板块里最近的一条，且有画面可放（横版封面，或片库条目可取背景图）。
 * @param records 继续观看记录（最近的在前）
 */
export function pickResumeRecord(
  records: readonly ContinueRecord[],
  sections: readonly ContinueSection[] = HOME_SECTIONS
): ContinueRecord | null {
  return (
    records.find(
      record =>
        sections.includes(record.section) &&
        (Boolean(record.cover) || libraryItemIdOf(record) !== null)
    ) ?? null
  )
}

/** 已播比例的整数百分比；时长未知或是「下一集」时为 null */
function percentOf(record: ContinueRecord): number | null {
  if (record.nextUp || !(record.duration > 0)) return null
  return Math.min(
    99,
    Math.max(1, Math.round((record.progress / record.duration) * 100))
  )
}

/**
 * 标签行：「本地片库 · 看到 62%」「在线 · 第 14 集 · 看到 40%」「本地片库 · 下一集 第 15 集」。
 * @param record 继续观看记录
 */
export function resumeKicker(record: ContinueRecord): string {
  const source = record.section === 'online' ? '在线' : '本地片库'
  if (record.nextUp)
    return [source, `下一集${record.episode ? ` ${record.episode}` : ''}`].join(
      ' · '
    )
  const percent = percentOf(record)
  return [
    source,
    record.episode ?? '',
    percent === null ? '继续观看' : `看到 ${percent}%`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 主按钮：「继续播放 · 剩 48 分钟」「继续播放 · 剩 1 小时 12 分」；下一集写「播放下一集」，时长未知写「继续播放」。
 * @param record 继续观看记录
 */
export function resumePlayLabel(record: ContinueRecord): string {
  if (record.nextUp) return '播放下一集'
  if (!(record.duration > 0)) return '继续播放'
  const minutes = Math.max(
    1,
    Math.round(Math.max(0, record.duration - record.progress) / 60)
  )
  if (minutes < 60) return `继续播放 · 剩 ${minutes} 分钟`
  const m = minutes % 60
  return `继续播放 · 剩 ${Math.floor(minutes / 60)} 小时${m ? ` ${m} 分` : ''}`
}

/**
 * 拼轮播：继续观看那一张在最前，后面接精选，按 key 去重，最多 max 张。
 * @param first 继续观看那一张；没有为 null
 * @param rest 精选来源的几张
 */
export function composeSlides<T extends { key: string }>(
  first: T | null,
  rest: readonly T[],
  max = HERO_SLIDES
): T[] {
  const seen = new Set<string>()
  return [...(first ? [first] : []), ...rest]
    .filter(slide => !seen.has(slide.key) && seen.add(slide.key))
    .slice(0, max)
}
