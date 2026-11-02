/**
 * 播放记录域 playback（ADR-0031）：继续观看、在线进度、已看、收藏，存在片库数据库的 user_state 表。
 *
 * 每个键存一份与桌面 localStorage 同形状的 JSON（键名也相同），改动全部走 src/shared/playback 的规则；
 * node:sqlite 是同步的，一次调用里的「读 → 改 → 写」不会和别的请求交错。
 */
import type { DatabaseSync } from 'node:sqlite'

import { playback } from '../../shared/contract/playback'
import type { DoubanItem } from '../../shared/douban/item'
import {
  type ContinueMeta,
  type ContinueRecord,
  type ContinueReplay,
  type ContinueTombstones,
  type ProgressUpdate,
  addTombstone,
  applyProgress,
  sanitizeRecords,
  startRecord,
} from '../../shared/playback/continue-rules'
import {
  hasFavorite,
  parseFavorites,
  toggleFavoriteIn,
} from '../../shared/playback/favorites'
import {
  type MediaProgress,
  type ProgressMap,
  parseProgressMap,
  progressOf,
  putProgress,
} from '../../shared/playback/media-progress'
import {
  type WatchedEntry,
  addWatched,
  isWatchedEntry,
} from '../../shared/playback/watched-rules'
import type { DomainRegistry } from '../domains/registry'

/** user_state 里的键（与桌面 localStorage 的键相同，以后导入时原样搬） */
export const STATE_KEYS = {
  continue: 'continue_watching',
  tombstones: 'continue_removed',
  progress: 'media_play_progress',
  watched: 'media_watched',
  favorites: 'media_favorites',
} as const

/** 一个键的 JSON 读写 */
export interface UserState {
  read<T>(key: string, parse: (raw: unknown) => T): T
  write(key: string, value: unknown): void
}

/** user_state 表上的读写；坏掉的 JSON 当作没有 */
export function sqliteUserState(
  db: DatabaseSync,
  now: () => number = Date.now
): UserState {
  const select = db.prepare('SELECT value FROM user_state WHERE key = ?')
  const upsert = db.prepare(
    `INSERT INTO user_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
  return {
    read(key, parse) {
      const row = select.get(key) as { value: string } | undefined
      let raw: unknown = undefined
      try {
        raw = row ? JSON.parse(row.value) : undefined
      } catch {
        raw = undefined
      }
      return parse(raw)
    },
    write(key, value) {
      upsert.run(key, JSON.stringify(value), now())
    },
  }
}

const parseTombstones = (raw: unknown): ContinueTombstones =>
  Object.fromEntries(
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is [string, number] =>
        Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number'
    )
  )

const parseWatched = (raw: unknown): WatchedEntry[] =>
  Array.isArray(raw) ? raw.filter(isWatchedEntry) : []

/** 播放记录的操作（与渲染层 continue-store / play-progress / favorites 一一对应） */
export interface Playback {
  continueList(): ContinueRecord[]
  continueStart(
    meta: ContinueMeta,
    replay: ContinueReplay,
    startAt: number
  ): string
  continueProgress(id: string, update: ProgressUpdate): void
  continueFinish(id: string): void
  continueRemove(id: string): void
  progressGet(key: string): MediaProgress | null
  progressSave(key: string, progress: number, duration: number): void
  markWatched(key: string): void
  favorites(): DoubanItem[]
  toggleFavorite(item: DoubanItem): boolean
}

export function createPlayback(
  state: UserState,
  now: () => number = Date.now
): Playback {
  const records = (): ContinueRecord[] =>
    state.read(STATE_KEYS.continue, sanitizeRecords)
  const saveRecords = (next: ContinueRecord[]): void =>
    state.write(STATE_KEYS.continue, next)
  const progressMap = (): ProgressMap =>
    state.read(STATE_KEYS.progress, parseProgressMap)
  const watched = (): WatchedEntry[] =>
    state.read(STATE_KEYS.watched, parseWatched)
  const favorites = (): DoubanItem[] =>
    state.read(STATE_KEYS.favorites, parseFavorites)

  const continueProgress = (id: string, update: ProgressUpdate): void => {
    const before = records()
    const next = applyProgress(before, id, update, now())
    if (next !== before) saveRecords(next)
  }

  return {
    continueList: records,
    continueStart(meta, replay, startAt) {
      const next = startRecord(records(), meta, replay, startAt, now())
      saveRecords(next)
      return next[0].id
    },
    continueProgress,
    continueFinish(id) {
      const record = records().find(r => r.id === id)
      if (!record) return
      continueProgress(id, {
        index: record.replay.index ?? 0,
        progress: record.duration,
        duration: record.duration,
        ended: true,
      })
    },
    continueRemove(id) {
      const stones = state.read(STATE_KEYS.tombstones, parseTombstones)
      // 与桌面相同的存法：[id, 移除时间] 数组
      state.write(
        STATE_KEYS.tombstones,
        Object.entries(addTombstone(stones, id, now()))
      )
      saveRecords(records().filter(r => r.id !== id))
    },
    progressGet: key => progressOf(progressMap(), watched(), key),
    progressSave(key, progress, duration) {
      const next = putProgress(progressMap(), key, progress, duration, now())
      if (next) state.write(STATE_KEYS.progress, next)
    },
    markWatched(key) {
      state.write(STATE_KEYS.watched, addWatched(watched(), key, now()))
    },
    favorites,
    toggleFavorite(item) {
      const next = toggleFavoriteIn(favorites(), item)
      state.write(STATE_KEYS.favorites, next)
      return hasFavorite(next, item.url)
    },
  }
}

/** 登记播放记录域；返回操作（首页视图读继续观看用） */
export function registerPlayback(
  registry: DomainRegistry,
  db: DatabaseSync
): Playback {
  const ops = createPlayback(sqliteUserState(db))
  registry.implement(playback, {
    continueList: () => ops.continueList(),
    continueStart: (_, meta, replay, startAt) =>
      ops.continueStart(meta, replay, startAt),
    continueProgress: (_, id, update) => ops.continueProgress(id, update),
    continueFinish: (_, id) => ops.continueFinish(id),
    continueRemove: (_, id) => ops.continueRemove(id),
    progressGet: (_, key) => ops.progressGet(key),
    progressSave: (_, key, progress, duration) =>
      ops.progressSave(key, progress, duration),
    markWatched: (_, key) => ops.markWatched(key),
    favorites: () => ops.favorites(),
    toggleFavorite: (_, item) => ops.toggleFavorite(item),
  })
  return ops
}
