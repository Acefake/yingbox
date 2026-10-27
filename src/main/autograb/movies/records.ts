/**
 * 电影追踪记录的纯操作：新建记录、写入 TMDB 信息（重算开始搜的日期）、到发行日时转为搜索中。
 */
import { addDays, localDate, searchStart } from '../schedule-rules'
import { releaseStart } from './movie-rules'
import type { MovieRecord } from './state'
import type { MovieInfo } from './tmdb'

/** 刚加进追踪的电影：跟随全局方式、没有偏好覆盖、等发行（调用方再 applyInfo / advance） */
export function newRecord(
  tmdbId: number,
  info: MovieInfo,
  now: number
): MovieRecord {
  return {
    tmdbId,
    title: info.title,
    originalTitle: info.originalTitle,
    year: info.year,
    poster: info.poster,
    premiere: info.premiere,
    releaseDate: null,
    dateSource: null,
    searchFrom: null,
    checkedAt: now,
    mode: 'inherit',
    prefs: {},
    status: 'upcoming',
    attempts: 0,
    nextTry: null,
    candidates: [],
    error: null,
    addedAt: now,
    savedAt: null,
    savedName: null,
    savedCid: null,
    notified: false,
  }
}

/** TMDB 信息写进记录，重算开始搜的日期 */
export function applyInfo(
  record: MovieRecord,
  info: MovieInfo,
  now: number
): void {
  const start = releaseStart(
    info.releaseDates,
    info.premiere,
    localDate(now),
    addDays
  )
  Object.assign(record, {
    title: info.title,
    originalTitle: info.originalTitle,
    year: info.year,
    poster: info.poster,
    premiere: info.premiere,
    releaseDate: start.date,
    dateSource: start.source,
    checkedAt: now,
  })
}

/**
 * 到了发行日（当天 20:00）就开始搜。加入时早已发行的，30 天从加入当天算，并且马上搜。
 * @returns 是否有改动
 */
export function advance(record: MovieRecord, now: number): boolean {
  if (record.status !== 'upcoming' || !record.releaseDate) return false
  if (now < searchStart(record.releaseDate)) return false
  const added = localDate(record.addedAt)
  const late = record.releaseDate < added
  record.status = 'searching'
  record.searchFrom = late ? added : record.releaseDate
  record.nextTry = late ? now : searchStart(record.releaseDate)
  return true
}
