/**
 * 库外片子的入库状态（模块级单例，助手卡片与首页候选面板共用）：转存中 → 已转存，等待入库 → 已入库。
 *
 * 转存成功后每分钟按片名查一次本地媒体库（tmdb 来源），查到同一部就记为已入库并带上条目 id（可直接播放）；
 * 查满 {@link WATCH_LIMIT} 次仍没有就停在「已转存，等待入库」（主进程 10 分钟后会主动通知媒体库扫描）。
 */
import { reactive } from 'vue'

import { findLibraryItems } from '@/features/library'

import { type DiscoverTitle, findInLibrary, titleKey } from './discover-rules'

/** 入库状态 */
export type DiscoverPhase = 'saving' | 'saved' | 'done'

/** 一部片子的状态 */
export interface DiscoverEntry {
  phase: DiscoverPhase
  /** 已入库时的媒体库条目 id */
  itemId: number | null
}

/** 多久查一次媒体库 */
const WATCH_MS = 60_000
/** 最多查几次（约 40 分钟） */
const WATCH_LIMIT = 40

const entries = reactive(new Map<string, DiscoverEntry>())
const watching = new Set<string>()

/** 某部片子的状态（响应式）；没有时为 null */
export function discoverEntry(
  title: Pick<DiscoverTitle, 'title' | 'year'>
): DiscoverEntry | null {
  return entries.get(titleKey(title)) ?? null
}

/** 状态的一句话：转存中 / 已转存，等待入库 / 已入库；没有状态时为「未入库」 */
export function phaseLabel(entry: DiscoverEntry | null): string {
  if (!entry) return '未入库'
  return {
    saving: '入库中',
    saved: '已转存，等待入库',
    done: '已入库',
  }[entry.phase]
}

/** 标成转存中 */
export function markSaving(title: DiscoverTitle): void {
  entries.set(titleKey(title), { phase: 'saving', itemId: null })
}

/** 转存失败：清掉状态，回到未入库 */
export function clearPhase(title: DiscoverTitle): void {
  const key = titleKey(title)
  if (entries.get(key)?.phase === 'saving') entries.delete(key)
}

/** 查一次媒体库；查到就记为已入库 */
export async function checkLibrary(title: DiscoverTitle): Promise<boolean> {
  const lookup = await findLibraryItems('tmdb', title.title, 6).catch(
    () => null
  )
  const item = lookup ? findInLibrary(title, lookup.items) : null
  if (!item) return false
  entries.set(titleKey(title), { phase: 'done', itemId: item.id })
  return true
}

/** 转存成功：标成等待入库，并开始定时查媒体库 */
export function markSaved(title: DiscoverTitle): void {
  const key = titleKey(title)
  entries.set(key, { phase: 'saved', itemId: null })
  if (watching.has(key)) return
  watching.add(key)
  let tries = 0
  const tick = async (): Promise<void> => {
    tries++
    const done = await checkLibrary(title)
    if (done || tries >= WATCH_LIMIT) watching.delete(key)
    else setTimeout(() => void tick(), WATCH_MS)
  }
  setTimeout(() => void tick(), WATCH_MS)
}
