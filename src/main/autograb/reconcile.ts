/**
 * 追更状态的纯操作 · 剧换了条目 id：片库重建（换成混合库、重新扫描）后同一部剧拿到新的条目 id，
 * 旧 id 下的设置与各集记录会变成孤儿——追更页出现两部同名的剧，方式、文件夹、确认数留在看不到的那一份上。
 * 每轮拿到日历时把它们并到日历里的新 id 上。
 *
 * 只并确认已经不在片库里的旧 id（missingSeries 逐个问片库；问不到就不并），库里还在的剧（休播、完结）不会被并走。
 * 认同一部剧：两边都知道 TMDB id 时只看 id；有一边不知道（迁移前的老设置、旧版片库服务）时退回剧名完全相同，
 * 且日历里只有一部叫这个名字。日历里还在的 id 不会被并走，同时在播的两部同名剧互不影响。
 */
import type { CalendarEpisode } from '../../shared/library/ipc'
import { episodeKey } from './schedule-rules'
import {
  type AutograbState,
  type EpisodeRecord,
  type SeriesSetting,
} from './state'

/** 一集记录的进度先后：并记录时同一集留走得更远的那条 */
const PROGRESS: Record<EpisodeRecord['status'], number> = {
  waiting: 0,
  notFound: 1,
  found: 2,
  noSpace: 2,
  skipped: 3,
  saved: 4,
  done: 5,
}

/** 两份设置并成一份，按字段取：方式新 id 设过的优先，偏好逐项合并（新的覆盖旧的），文件夹缺了互补，确认数取大的 */
function mergeSetting(
  current: SeriesSetting | undefined,
  old: SeriesSetting
): SeriesSetting {
  if (!current) return { ...old }
  const folder = current.cid ? current : old
  return {
    ...old,
    ...current,
    mode: current.mode !== 'inherit' ? current.mode : old.mode,
    prefs: { ...old.prefs, ...current.prefs },
    cid: folder.cid,
    cidName: folder.cidName,
    confirmed: Math.max(current.confirmed, old.confirmed),
    confirmFirst: current.confirmFirst ?? old.confirmFirst,
  }
}

/**
 * 旧 id 下的各集记录挪到新 id；新 id 上已有同一集时留进度更远的。
 * 记录对象原地改键（不复制），正在进行的手动转存 / 撤销拿着的引用仍然有效。
 */
function moveEpisodes(state: AutograbState, from: number, to: number): void {
  for (const [key, record] of Object.entries(state.episodes)) {
    if (record.seriesId !== from) continue
    delete state.episodes[key]
    const target = episodeKey(to, record.season, record.episode)
    const existing = state.episodes[target]
    if (existing && PROGRESS[existing.status] >= PROGRESS[record.status])
      continue
    record.key = target
    record.seriesId = to
    state.episodes[target] = record
  }
}

/** 日历里每部剧的剧名与 TMDB id */
function airingSeries(
  episodes: CalendarEpisode[]
): Map<number, { title: string; tmdbId?: string }> {
  const airing = new Map<number, { title: string; tmdbId?: string }>()
  for (const ep of episodes)
    if (!airing.has(ep.seriesId))
      airing.set(ep.seriesId, { title: ep.seriesTitle, tmdbId: ep.tmdbId })
  return airing
}

/**
 * 有设置、却不在这次日历里的剧，逐个问片库还在不在；确认不在的才返回。
 * 片库问不了（没有 exists）或查询出错的都当还在，不并。
 */
async function missingSeries(
  state: AutograbState,
  episodes: CalendarEpisode[],
  exists: ((seriesId: number, title: string) => Promise<boolean>) | undefined
): Promise<Set<number>> {
  const missing = new Set<number>()
  if (!exists) return missing
  const airing = new Set(episodes.map(ep => ep.seriesId))
  for (const key of Object.keys(state.series)) {
    const id = Number(key)
    if (airing.has(id)) continue
    try {
      if (!(await exists(id, state.series[key].title))) missing.add(id)
    } catch {
      // 查不到就当还在
    }
  }
  return missing
}

/**
 * 日历 → 把换了 id 的剧（missing 里的旧 id）的设置与记录并到新 id，并给日历里有设置或有记录的剧记下 TMDB id，
 * 下次片库再重建时能按 id 认。返回是否有改动。
 */
function reconcileSeries(
  state: AutograbState,
  episodes: CalendarEpisode[],
  missing: ReadonlySet<number>
): boolean {
  let changed = false
  const airing = airingSeries(episodes)
  const titles = new Map<string, number>()
  for (const info of airing.values())
    titles.set(info.title, (titles.get(info.title) ?? 0) + 1)
  for (const [id, info] of airing) {
    const key = String(id)
    for (const [oldKey, old] of Object.entries(state.series)) {
      if (oldKey === key || !missing.has(Number(oldKey))) continue
      const same =
        info.tmdbId && old.tmdbId
          ? info.tmdbId === old.tmdbId
          : info.title === old.title && titles.get(info.title) === 1
      if (!same) continue
      state.series[key] = mergeSetting(state.series[key], old)
      delete state.series[oldKey]
      moveEpisodes(state, Number(oldKey), id)
      changed = true
    }
    // 只给已有设置记 TMDB id；两边 id 都有却不同，说明条目 id 被别的剧复用了，不覆盖
    const setting = state.series[key]
    if (
      !setting ||
      (setting.tmdbId && info.tmdbId && setting.tmdbId !== info.tmdbId)
    )
      continue
    if (
      setting.title !== info.title ||
      (info.tmdbId && setting.tmdbId !== info.tmdbId)
    ) {
      setting.title = info.title
      if (info.tmdbId) setting.tmdbId = info.tmdbId
      changed = true
    }
  }
  return changed
}

/**
 * 每轮拿到日历后调用：问片库哪些旧 id 已经没有了，再把它们并到日历里的新 id（规则见文件头）。返回是否有改动。
 */
export async function adoptRenamed(
  state: AutograbState,
  episodes: CalendarEpisode[],
  exists: ((seriesId: number, title: string) => Promise<boolean>) | undefined
): Promise<boolean> {
  const missing = await missingSeries(state, episodes, exists)
  return reconcileSeries(state, episodes, missing)
}
