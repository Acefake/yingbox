/**
 * 入库推送的纯规则：新入库 / 追更入库 → 一条推送项；一批推送项 → 一条消息（标题 + 正文）。
 *
 * 去重键：电影 `movie:<条目 id>`，集 `ep:<剧 id>:<季>:<集>`。追更入库（autograb 记录）和片库新入库对同一集
 * 用同一个键，所以同一集只推一次；片库先看到时，按追更记录把它标成「追更」。
 */
import type { LibraryArrival } from '../../shared/library/arrivals'

/** 推送类型：追更转存的集入库、片库新增剧集、片库新增电影（各自可在设置里关掉）。 */
export type NotifyKind = 'autograb' | 'episode' | 'movie'

/** 一条推送项。 */
export interface NotifyItem {
  kind: NotifyKind
  /** 去重键 */
  key: string
  /** 电影名 / 剧名 */
  title: string
  /** 第几季第几集 · 集名；电影是年份 */
  detail: string
}

/** 一条要发出去的消息。 */
export interface NotifyMessage {
  title: string
  body: string
}

/** 追更里转存过、刚入库的一集（autograb 的 EpisodeRecord 子集）。 */
export interface LandedEpisode {
  seriesId: number
  seriesTitle: string
  season: number
  episode: number
}

/** 合并后正文最多列几行。 */
export const MAX_LINES = 8

const pad = (n: number): string => String(n).padStart(2, '0')

/** S01E05 */
export function episodeCode(
  season: number | null,
  episode: number | null
): string {
  if (season === null && episode === null) return ''
  if (season === null) return `E${pad(episode!)}`
  return episode === null
    ? `S${pad(season)}`
    : `S${pad(season)}E${pad(episode)}`
}

/** 去重键。 */
export function episodeKey(
  seriesId: number,
  season: number | null,
  episode: number | null
): string {
  return `ep:${seriesId}:${season ?? ''}:${episode ?? ''}`
}

/**
 * 片库新入库 → 推送项。
 * @param autograbSaved 这一集是不是追更转存、还在等入库的
 */
export function itemFromArrival(
  arrival: LibraryArrival,
  autograbSaved: (seriesId: number, season: number, episode: number) => boolean
): NotifyItem {
  const title = arrival.title || '未识别的条目'
  if (arrival.kind === 'movie') {
    return {
      kind: 'movie',
      key: `movie:${arrival.itemId}`,
      title,
      detail: arrival.year ? String(arrival.year) : '',
    }
  }
  const { season, episode } = arrival
  const fromAutograb =
    season !== null &&
    episode !== null &&
    autograbSaved(arrival.topId, season, episode)
  const code = episodeCode(season, episode)
  return {
    kind: fromAutograb ? 'autograb' : 'episode',
    key: episodeKey(arrival.topId, season, episode),
    title,
    detail: [code, arrival.episodeTitle].filter(Boolean).join(' · '),
  }
}

/** 追更入库 → 推送项。 */
export function itemFromLanded(record: LandedEpisode): NotifyItem {
  return {
    kind: 'autograb',
    key: episodeKey(record.seriesId, record.season, record.episode),
    title: record.seriesTitle,
    detail: episodeCode(record.season, record.episode),
  }
}

const KIND_TITLE: Record<NotifyKind, string> = {
  autograb: '追更已入库',
  episode: '新剧集入库',
  movie: '新电影入库',
}

const line = (item: NotifyItem): string =>
  item.detail ? `${item.title} ${item.detail}` : item.title

/** 一批推送项 → 一条消息：一条时直接写；多条时标题写总数，正文一条一行（超过 {@link MAX_LINES} 行折叠）。 */
export function formatMessage(items: readonly NotifyItem[]): NotifyMessage {
  if (items.length === 1) {
    const item = items[0]
    return { title: KIND_TITLE[item.kind], body: line(item) }
  }
  const kinds = new Set(items.map(i => i.kind))
  const title =
    kinds.size === 1
      ? `${KIND_TITLE[items[0].kind]} ${items.length} 条`
      : `新入库 ${items.length} 条`
  const lines = items.slice(0, MAX_LINES).map(line)
  if (items.length > MAX_LINES)
    lines.push(`……还有 ${items.length - MAX_LINES} 条`)
  return { title, body: lines.join('\n') }
}

/** 把错误信息里的密钥换成 ***（Telegram 的 token 在 URL 里，网络错误常把 URL 带出来）。 */
export function redact(message: string, secrets: readonly string[]): string {
  let out = message
  for (const secret of secrets)
    if (secret.length >= 4) out = out.split(secret).join('***')
  return out
}
