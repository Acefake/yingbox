/**
 * 「想看」清单的存取：全应用一份响应式列表，持久化在 localStorage（watchlist）。
 *
 * - 详情页的「想看」按钮 toggleWatchlist；横排右键 / 悬停移除 removeFromWatchlist；
 * - 开始播放不移除；整部看完（继续播放判定单片或最后一集播到 95%）时按同一 id 自动移除，
 *   由应用入口调用 installWatchlist 订阅；
 * - 其它窗口改了存储（storage 事件）时同步。
 * 规则都在 watchlist-rules.ts。
 */
import { type Ref, ref } from 'vue'

import { onContinueFinished } from '@/features/player'
import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type WatchlistEntry,
  type WatchlistMeta,
  type WatchlistSection,
  hasEntry,
  removeEntry,
  sanitizeEntries,
  toggleEntry,
} from './watchlist-rules'

const STORAGE_KEY = 'watchlist'

function load(): WatchlistEntry[] {
  return sanitizeEntries(readStoredArray<unknown>(STORAGE_KEY))
}

let entries: Ref<WatchlistEntry[]> | null = null

function state(): Ref<WatchlistEntry[]> {
  if (entries) return entries
  entries = ref(load())
  if (typeof window !== 'undefined')
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY && entries) entries.value = load()
    })
  return entries
}

function commit(next: WatchlistEntry[]): void {
  const list = state()
  if (next === list.value) return
  list.value = next
  saveStoredArray(STORAGE_KEY, next)
}

/** 全部条目（响应式，只读；最近加入的在前）。 */
export function watchlistEntries(): Readonly<Ref<readonly WatchlistEntry[]>> {
  return state()
}

/** 是否已在清单里（在 computed / 模板里调用即为响应式）。 */
export function inWatchlist(section: WatchlistSection, key: string): boolean {
  return hasEntry(state().value, section, key)
}

/** 切换想看；返回切换后是否在清单里。 */
export function toggleWatchlist(meta: WatchlistMeta): boolean {
  // 载荷里可能带着 Vue 的响应式对象：存储前转成普通 JSON
  const plain = JSON.parse(JSON.stringify(meta)) as WatchlistMeta
  commit(toggleEntry(state().value, plain, Date.now()))
  return hasEntry(state().value, plain.section, plain.key)
}

/** 从清单里移除。 */
export function removeFromWatchlist(id: string): void {
  commit(removeEntry(state().value, id))
}

let uninstall: (() => void) | null = null

/** 订阅「整部看完」：看完的条目自动移出清单。应用入口调用一次，重复调用无副作用。 */
export function installWatchlist(): void {
  if (uninstall) return
  uninstall = onContinueFinished(removeFromWatchlist)
}
