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
} from '../../../../shared/contract/autograb-upgrade'

/** 洗版目标的说明：两种一样时「4K」，不一样时「电影 4K / 剧集 1080p」 */
export function targetsText(t: UpgradeOverview['targets']): string {
  return t.movie === t.tv
    ? resolutionText(t.movie)
    : `电影 ${resolutionText(t.movie)} / 剧集 ${resolutionText(t.tv)}`
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

/** 洗版的概况：「12 个文件不如首选（1080p），3 个有更好的版本」；目标 = 资源偏好里的首选分辨率 */
export function upgradeSummary(o: UpgradeOverview): string {
  if (!o.enabled) return '打开后每周找一次更清楚的版本，找到只提示，不自动替换'
  const low = o.counts.waiting + o.counts.found
  if (o.scannedAt === null) return '还没清点片库'
  if (!low && !o.counts.saved && !o.counts.replaced)
    return `片库里没有不如首选（${targetsText(o.targets)}）的文件`
  const parts = [`${low} 个文件不如首选（${targetsText(o.targets)}）`]
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

/** 要用户处理的电影：有资源待确认、找不到（有资源的在前） */
export function pendingMovies(o: MoviesOverview | null): TrackedMovie[] {
  return (o?.movies ?? [])
    .filter(m => m.status === 'found' || m.status === 'notFound')
    .sort((a, b) => Number(b.status === 'found') - Number(a.status === 'found'))
}

/** 电影栏的状态句：「4 部在追 · 1 部未上线 · 2 部搜索中」 */
export function moviesStatusLine(o: MoviesOverview): string {
  const count = (status: MovieTrackStatus): number =>
    o.movies.filter(m => m.status === status).length
  if (o.running) return `${o.movies.length} 部在追 · 正在检查`
  const parts = [`${o.movies.length} 部在追`]
  if (count('upcoming')) parts.push(`${count('upcoming')} 部未上线`)
  if (count('searching')) parts.push(`${count('searching')} 部搜索中`)
  return parts.join(' · ')
}

/** 电影卡片上那句「为什么要你处理」 */
export function moviePendingReason(m: TrackedMovie): string {
  if (m.status === 'notFound')
    return (
      m.error ?? '30 天里每天搜都没找到这部电影的分享，点「现在重搜」再找一遍。'
    )
  return m.effectiveMode === 'auto'
    ? '匹配分不够高，没有替你自动转存，请看一眼文件名。'
    : '电影设为待确认，由你来点转存。'
}

/** 洗版：有更清楚的版本、等用户替换的条目 */
export function upgradeFound(o: UpgradeOverview | null): UpgradeEntry[] {
  return (o?.entries ?? []).filter(e => e.status === 'found')
}

/** 洗版：新文件已存好、旧文件还在的条目（可删旧文件） */
export function upgradeReplaced(o: UpgradeOverview | null): UpgradeEntry[] {
  return (o?.entries ?? []).filter(e => e.status === 'replaced')
}

/** 洗版：其余条目（等待搜索、已转存、旧文件已删、不洗），收在记录里 */
export function upgradeOthers(o: UpgradeOverview | null): UpgradeEntry[] {
  return (o?.entries ?? []).filter(
    e => e.status !== 'found' && e.status !== 'replaced'
  )
}

/** 洗版卡片上的说明：「现在 1080p · 首选 4K」 */
export function upgradeGap(e: UpgradeEntry, o: UpgradeOverview): string {
  const target = e.kind === 'movie' ? o.targets.movie : o.targets.tv
  return `现在 ${resolutionText(e.resolution)} · 首选 ${resolutionText(target)}`
}
