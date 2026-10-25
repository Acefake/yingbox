/**
 * 洗版 / 电影追踪界面的纯规则：状态文案、条目名、候选说明、各种提示。
 */
import type {
  GrabCandidate,
  MovieTrackStatus,
  MoviesOverview,
  TrackedMovie,
  UpgradeEntry,
  UpgradeOverview,
  UpgradeStatus,
  UpgradeTarget,
} from '../../../../shared/contract/autograb-upgrade'

/** 目标分辨率选项（分段控件只收字符串值） */
export const TARGET_OPTIONS: { value: `${UpgradeTarget}`; label: string }[] = [
  { value: '1080', label: '1080p' },
  { value: '2160', label: '4K' },
]

/** 分段控件的值 → 目标分辨率 */
export function targetOf(value: string): UpgradeTarget {
  return value === '2160' ? 2160 : 1080
}

/** 洗版状态文案 */
export const UPGRADE_STATUS_LABEL: Record<UpgradeStatus, string> = {
  waiting: '等待搜索',
  found: '有更清楚的',
  saved: '已转存',
  replaced: '已有新版',
  cleaned: '旧文件已删',
  ignored: '不洗',
}

/** 电影追踪状态文案 */
export const MOVIE_STATUS_LABEL: Record<MovieTrackStatus, string> = {
  upcoming: '未上线',
  searching: '搜索中',
  found: '有资源',
  saved: '已转存',
  done: '已入库',
  notFound: '没找到',
}

/** 分辨率显示名：2160 → 4K，1080 → 1080p，null → 未知 */
export function resolutionText(value: number | null): string {
  if (value === null) return '未知'
  return value >= 2160 ? '4K' : `${value}p`
}

/** 洗版条目名：「繁花 S01E05」或「流浪地球 (2019)」 */
export function entryName(e: UpgradeEntry): string {
  if (e.kind === 'episode') {
    const pad = (n: number | null): string => String(n ?? 0).padStart(2, '0')
    return `${e.title} S${pad(e.season)}E${pad(e.episode)}`
  }
  return e.year ? `${e.title} (${e.year})` : e.title
}

/** 字节 → 1.2 GB / 830 MB */
export function sizeText(bytes: number): string {
  if (bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** 候选的一行说明：分数 · 体积 · 理由 */
export function candidateMeta(c: GrabCandidate): string {
  return [`${c.score} 分`, sizeText(c.size), ...c.reasons]
    .filter(Boolean)
    .join(' · ')
}

/** 洗版面板上方的提示；没问题时为 null */
export function upgradeNotice(o: UpgradeOverview): string | null {
  if (!o.ready.loggedIn) return '先在设置 · 网盘里扫码登录 115'
  if (!o.ready.pansou) return '先在设置 · 网盘里填写 PanSou 地址'
  if (!o.ready.cloudLibraries)
    return '洗版只支持放在 115（CloudDrive2 挂载）上、用 TMDB 识别的媒体库'
  return o.pauseReason
}

/** 洗版的概况：「12 个文件低于 1080p，3 个有更清楚的版本」 */
export function upgradeSummary(o: UpgradeOverview): string {
  if (!o.enabled) return '打开后每周找一次更清楚的版本，找到只提示，不自动替换'
  const low = o.counts.waiting + o.counts.found
  if (o.scannedAt === null) return '还没清点片库'
  if (!low && !o.counts.saved && !o.counts.replaced)
    return `片库里没有低于 ${resolutionText(o.target)} 的文件`
  const parts = [`${low} 个文件低于 ${resolutionText(o.target)}`]
  if (o.counts.found) parts.push(`${o.counts.found} 个有更清楚的版本`)
  return parts.join('，')
}

/** 电影面板上方的提示；没问题时为 null */
export function moviesNotice(o: MoviesOverview): string | null {
  if (!o.ready.tmdb) return '先在设置里填写 TMDB 令牌'
  if (!o.ready.loggedIn) return '先在设置 · 网盘里扫码登录 115'
  if (!o.ready.pansou) return '先在设置 · 网盘里填写 PanSou 地址'
  return o.pauseReason
}

/** 一部电影的次要说明：上线日期 / 搜索进度 / 失败原因 */
export function movieNote(m: TrackedMovie): string {
  if (m.error && m.status !== 'found') return m.error
  if (m.status === 'upcoming')
    return m.releaseDate
      ? `${m.releaseDate} ${m.dateSource === 'physical' ? '实体发行' : '数字发行'}后开始搜`
      : 'TMDB 还没有发行日期，过几天再看'
  if (m.status === 'searching')
    return m.attempts
      ? `已搜 ${m.attempts} 次，每天一次，30 天为止`
      : '今天开始搜'
  return ''
}

/** 想看清单里可以拿来搜电影的片名：在线板块（媒体库板块的片已在库里），去重，最多 12 个 */
export function watchlistTitles(
  entries: readonly { section: string; title: string }[]
): string[] {
  const titles = entries
    .filter(e => e.section === 'online' && e.title.trim())
    .map(e => e.title.trim())
  return [...new Set(titles)].slice(0, 12)
}
