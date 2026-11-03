import type { DoubanItem } from '../douban/item'
import type {
  ContinueMeta,
  ContinueRecord,
  ContinueReplay,
  ProgressUpdate,
} from '../playback/continue-rules'
import { isDoubanItem } from '../playback/favorites'
import type { MediaProgress } from '../playback/media-progress'
import type { PlaylistEntry } from '../playback/playlist'
import {
  ContractError,
  bool,
  call,
  defineDomain,
  int,
  num,
  oneOf,
  optArray,
  optStr,
  record,
  str,
} from './define'

/**
 * 服务端存的继续观看只收在线与 AV：片库（movie / tv / jav）的记录由片库观看进度推导，
 * 片库条目的进度走 library 的 progress.save。
 */
export const STORED_CONTINUE_SECTIONS = ['online', 'av'] as const

function playlist(value: unknown, name: string): PlaylistEntry[] | undefined {
  const list = optArray<unknown>(value, name)
  return list?.map((entry, i) => {
    const e = record<Record<string, unknown>>(entry, `${name}[${i}]`)
    return {
      url: optStr(e.url, `${name}[${i}].url`),
      filePath: optStr(e.filePath, `${name}[${i}].filePath`),
      name: optStr(e.name, `${name}[${i}].name`),
      siteName: optStr(e.siteName, `${name}[${i}].siteName`),
      ...(e.ext == null
        ? {}
        : { ext: record<Record<string, unknown>>(e.ext, `${name}[${i}].ext`) }),
    }
  })
}

/** 开播时的条目身份 */
function parseMeta(value: unknown): ContinueMeta {
  const m = record<Record<string, unknown>>(value, 'meta')
  return {
    section: oneOf(m.section, 'meta.section', STORED_CONTINUE_SECTIONS),
    key: text(m.key, 'meta.key'),
    title: text(m.title, 'meta.title'),
    cover: optStr(m.cover, 'meta.cover'),
    // 打开详情时交回客户端的数据，服务端不解读；太大的不存
    detail:
      m.detail != null && JSON.stringify(m.detail).length <= DETAIL_LIMIT
        ? m.detail
        : undefined,
    partial: m.partial == null ? undefined : bool(m.partial, 'meta.partial'),
  }
}

/** 重新打开播放器的载荷 */
function parseReplay(value: unknown): ContinueReplay {
  const r = record<Record<string, unknown>>(value, 'replay')
  const replay: ContinueReplay = {
    url: optStr(r.url, 'replay.url'),
    filePath: optStr(r.filePath, 'replay.filePath'),
    playlist: playlist(r.playlist, 'replay.playlist'),
    index: r.index == null ? undefined : index(r.index, 'replay.index'),
    fallbacks: playlist(r.fallbacks, 'replay.fallbacks'),
  }
  if (!replay.url && !replay.filePath && !replay.playlist?.length)
    throw new ContractError('replay 至少要有 url、filePath 或 playlist')
  return replay
}

/** 打开详情用的数据序列化后最多这么大，超出就不存（每次记进度都要整份读写） */
const DETAIL_LIMIT = 64 * 1024

const text = (value: unknown, name: string): string => {
  const v = str(value, name)
  if (!v.trim()) throw new ContractError(`${name} 不能为空`)
  return v
}

const index = (value: unknown, name: string): number => {
  const n = int(value, name)
  if (n < 0) throw new ContractError(`${name} 不能为负数`)
  return n
}

const seconds = (value: unknown, name: string): number => {
  const n = num(value, name)
  if (n < 0) throw new ContractError(`${name} 不能为负数`)
  return n
}

function parseUpdate(value: unknown): ProgressUpdate {
  const u = record<Record<string, unknown>>(value, 'update')
  return {
    index: index(u.index, 'update.index'),
    episode: optStr(u.episode, 'update.episode'),
    progress: seconds(u.progress, 'update.progress'),
    duration: seconds(u.duration, 'update.duration'),
    ended: u.ended == null ? undefined : bool(u.ended, 'update.ended'),
  }
}

/** 豆瓣卡：只留已知字段，客户端多塞的不进存储 */
function parseDoubanItem(value: unknown): DoubanItem {
  if (!isDoubanItem(value)) throw new ContractError('参数 item 应为豆瓣卡')
  const v = value
  return {
    title: v.title,
    searchTitle: v.searchTitle,
    original_title: v.original_title,
    cover: v.cover,
    coverSrc: v.coverSrc,
    rate: v.rate,
    url: v.url,
    year: v.year,
    type: v.type,
    overview: v.overview,
    ...(v.backdrop === undefined ? {} : { backdrop: v.backdrop }),
    ...(v.tmdbRate === undefined ? {} : { tmdbRate: v.tmdbRate }),
    ...(v.kind === undefined ? {} : { kind: v.kind }),
  }
}

/**
 * 播放记录（ADR-0031）：继续观看、在线进度、已看、收藏，存在服务端片库数据库的 user_state 表，
 * 规则与桌面 localStorage 版本同一份（src/shared/playback）。只在 src/server 实现，给安卓原生端用。
 * 无痕模式是客户端状态：无痕时客户端不调写入方法。
 */
export const playback = defineDomain('playback', {
  /** 继续观看（在线与 AV），最近的在前 */
  continueList: call<ContinueRecord[]>(),
  /** 开播时登记，返回记录 id（之后记进度用） */
  continueStart: call<
    [meta: ContinueMeta, replay: ContinueReplay, startAt: number],
    string
  >(a => [parseMeta(a[0]), parseReplay(a[1]), seconds(a[2] ?? 0, 'startAt')]),
  /** 播放中记一次进度：看完换下一集，最后一集看完移除 */
  continueProgress: call<[id: string, update: ProgressUpdate], void>(a => [
    str(a[0], 'id'),
    parseUpdate(a[1]),
  ]),
  /** 手动标记看完 */
  continueFinish: call<[id: string], void>(a => [str(a[0], 'id')]),
  /** 从继续观看移除（记墓碑） */
  continueRemove: call<[id: string], void>(a => [str(a[0], 'id')]),
  /** 一个进度键（地址或文件路径）的观看情况；没有记录为 null */
  progressGet: call<[key: string], MediaProgress | null>(a => [
    str(a[0], 'key'),
  ]),
  /** 记一次在线进度 */
  progressSave: call<[key: string, progress: number, duration: number], void>(
    a => [
      str(a[0], 'key'),
      seconds(a[1], 'progress'),
      seconds(a[2] ?? 0, 'duration'),
    ]
  ),
  /** 一个进度键看完了（加进「已看完」集合） */
  markWatched: call<[key: string], void>(a => [str(a[0], 'key')]),
  /** 收藏的豆瓣卡，新收藏在前 */
  favorites: call<DoubanItem[]>(),
  /** 收藏 / 取消收藏，返回之后是否已收藏 */
  toggleFavorite: call<[item: DoubanItem], boolean>(a => [
    parseDoubanItem(a[0]),
  ]),
})
