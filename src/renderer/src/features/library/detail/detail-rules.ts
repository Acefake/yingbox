/**
 * 条目详情的纯规则：信息行、季排序与命名、集列表、演职员、信息表、文件列表、播放按钮文字。
 * 不依赖 Vue，便于单测。
 */
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import { formatRating } from '../../../../../shared/library/rating'
import { MATCH_STATE_LABEL, formatRuntime } from '../shared/format'

/** 标题级元数据（电影 / 剧集本身的）。 */
export type TitleMeta = Extract<
  NonNullable<LibraryItemNode['metadata']>,
  { level: 'title' }
>

/** 节点的标题级元数据；没有时 null。 */
export function titleMetaOf(node: LibraryItemNode | null): TitleMeta | null {
  return node?.metadata?.level === 'title' ? node.metadata : null
}

/** 季的排序键：特别篇（第 0 季）排在最后，没有季号的排在正片之后。 */
export function seasonOrder(season: LibraryItemNode): number {
  return season.seasonNumber === 0 ? 1e6 : (season.seasonNumber ?? 1e5)
}

/** 剧集下的季，按 seasonOrder 排序。 */
export function sortedSeasons(node: LibraryItemNode | null): LibraryItemNode[] {
  const seasons = (node?.children ?? []).filter(
    child => child.type === 'season'
  )
  const direct = node?.children.filter(child => child.type === 'episode') ?? []
  if (node && direct.length)
    seasons.push({
      ...node,
      type: 'season',
      title: '全部集数',
      seasonNumber: null,
      children: direct,
    })
  return seasons.sort((a, b) => seasonOrder(a) - seasonOrder(b))
}

/** 季的显示名：特别篇 / 第 N 季 / 没有季号时用标题。 */
export function seasonName(season: LibraryItemNode): string {
  if (season.seasonNumber === 0) return '特别篇'
  return season.seasonNumber === null
    ? season.title
    : `第 ${season.seasonNumber} 季`
}

/** 默认选中的季：排序后的第一季；没有季时空串。 */
export function defaultSeasonKey(node: LibraryItemNode | null): string {
  const first = sortedSeasons(node)[0]
  return first ? String(first.id) : ''
}

/** 一季里的集（含本地缺失的），按集号排序。 */
export function seasonEpisodes(
  season: LibraryItemNode | null
): LibraryItemNode[] {
  return (season?.children ?? [])
    .filter(child => child.type === 'episode')
    .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
}

/** 头图信息行：年份 · 时长（电影）/ N 季（剧集，不含特别篇）· 分级 · ★ 来源 评分 · 前三个类型。 */
export function metaLineOf(
  node: LibraryItemNode | null,
  seasons: LibraryItemNode[]
): string[] {
  if (!node) return []
  const meta = titleMetaOf(node)
  const parts: string[] = []
  if (node.year) parts.push(String(node.year))
  if (node.type === 'movie' && node.runtime) {
    parts.push(formatRuntime(node.runtime))
  }
  if (node.type === 'series' && seasons.length) {
    parts.push(`${seasons.filter(s => s.seasonNumber !== 0).length} 季`)
  }
  if (meta?.certification) parts.push(meta.certification)
  const rating = formatRating(node.rating, node.ratingSource)
  if (rating) parts.push(`★ ${rating}`)
  if (node.genres.length) parts.push(node.genres.slice(0, 3).join(' / '))
  return parts
}

/** 演职员卡片。 */
export interface PersonCard {
  key: string
  name: string
  role: string
  photo: string | null
  /** 演员库里的演员（番号库条目）；有时可点开演员详情。 */
  actorId?: number
}

/** 演员库里的演员（按名字查），用来让演员可点、并换成本地缓存的头像。 */
export interface ActorLink {
  id: number
  /** 已换成界面地址的头像。 */
  photo: string | null
}

/** 名字比较键：NFKC + 压缩空白 + 小写（与引擎的演员名字键一致）。 */
export const personKey = (name: string): string =>
  name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** 演职员：导演 / 主创在前，然后演员表。 */
export function peopleOf(
  meta: TitleMeta | null,
  photo: (path: string | undefined) => string | null,
  actors: ReadonlyMap<string, ActorLink> = new Map()
): PersonCard[] {
  if (!meta) return []
  const crew = meta.crew
    .filter(p => p.job === 'Director' || p.job === 'Creator')
    .map(p => ({
      key: `crew-${p.id}-${p.job}`,
      name: p.name,
      role: p.job === 'Director' ? '导演' : '主创',
      photo: photo(p.profilePath),
    }))
  const cast = meta.cast.map(p => {
    const actor = actors.get(personKey(p.name))
    return {
      key: `cast-${p.id}`,
      name: p.name,
      role: p.character ?? '',
      photo: actor?.photo ?? photo(p.profilePath),
      ...(actor ? { actorId: actor.id } : {}),
    }
  })
  return [...crew, ...cast]
}

/** 信息表：原名、上映、编剧、国家 / 地区、出品（前三）、状态、匹配、TMDB / IMDb 编号。 */
export function infoRowsOf(
  node: LibraryItemNode | null
): Array<{ label: string; value: string }> {
  if (!node) return []
  const meta = titleMetaOf(node)
  const rows: Array<{ label: string; value: string }> = []
  if (node.originalTitle && node.originalTitle !== node.title) {
    rows.push({ label: '原名', value: node.originalTitle })
  }
  if (meta?.releaseDate) rows.push({ label: '上映', value: meta.releaseDate })
  const writers = meta?.crew
    .filter(p => p.job === 'Screenplay' || p.job === 'Writer')
    .map(p => p.name)
  if (writers?.length) rows.push({ label: '编剧', value: writers.join('、') })
  if (meta?.countries.length) {
    rows.push({ label: '国家 / 地区', value: meta.countries.join('、') })
  }
  if (meta?.companies.length) {
    rows.push({ label: '出品', value: meta.companies.slice(0, 3).join('、') })
  }
  if (meta?.status) rows.push({ label: '状态', value: meta.status })
  // 未知状态（旧数据 / 假数据）没有文案：整行不显示，不留空值
  const match = MATCH_STATE_LABEL[node.matchState] as string | undefined
  if (match) rows.push({ label: '匹配', value: match })
  if (node.providerIds.tmdb) {
    const jav = meta?.ref?.provider === 'jav'
    rows.push({ label: jav ? '番号' : 'TMDB', value: node.providerIds.tmdb })
  }
  if (node.providerIds.imdb)
    rows.push({ label: 'IMDb', value: node.providerIds.imdb })
  return rows
}

/** 条目（含子孙）的全部视频文件，按路径自然排序。 */
export function allVideoFiles(node: LibraryItemNode | null): LibraryItemFile[] {
  const out: LibraryItemFile[] = []
  const visit = (n: LibraryItemNode): void => {
    for (const file of n.files) if (file.kind === 'video') out.push(file)
    n.children.forEach(visit)
  }
  if (node) visit(node)
  return out.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true })
  )
}

/** 主播放按钮文字：剧集带上要播的那一集，其余「播放」。 */
export function playLabelOf(
  type: LibraryItemNode['type'] | undefined,
  episodeName: string | undefined | null
): string {
  if (type !== 'series' || episodeName === null) return '播放'
  return `播放 ${episodeName ?? ''}`
}

/** 详情页剧照区最多显示的张数。 */
export const MAX_STILLS = 30

/**
 * 详情页剧照：元数据里的剧照（番号库各站点的样图）；没有剧照的电影 / 剧集退回除头图外的背景图。
 * 按路径去重，最多 MAX_STILLS 张。
 */
export function stillsOf(meta: TitleMeta | null): string[] {
  if (!meta) return []
  const pick = (role: 'still' | 'backdrop'): string[] =>
    meta.images.filter(img => img.role === role).map(img => img.path)
  let paths = pick('still')
  if (!paths.length) paths = pick('backdrop').slice(1)
  return [...new Set(paths)].slice(0, MAX_STILLS)
}
