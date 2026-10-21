/**
 * mpv 状态的初始值、要观察的属性，以及 track-list / playlist 原始数据到共享类型的整理。
 */
import type { MpvPlaylistEntry, MpvStatus, MpvTrack } from '../shared/mpv'

/** 播放器没在运行时的状态 */
export const DEFAULT_STATUS: MpvStatus = {
  running: false,
  paused: true,
  volume: 100,
  muted: false,
  speed: 1,
  tracks: [],
  playlist: [],
  playlistPos: 0,
}

/** 需要持续观察的 mpv 属性（按索引注册，从 1 开始） */
export const WATCH_PROPS = [
  'time-pos',
  'duration',
  'pause',
  'volume',
  'mute',
  'speed',
  'track-list',
  'media-title',
  'path',
  'playlist',
  'playlist-pos',
  'video-params',
]

/** mpv 的 track-list → 音轨 / 字幕轨列表 */
export function parseTracks(raw: Record<string, unknown>[]): MpvTrack[] {
  if (!Array.isArray(raw)) return []
  return raw.map(t => ({
    id: t.id as number,
    type: t.type as MpvTrack['type'],
    title: t.title as string | undefined,
    lang: t.lang as string | undefined,
    selected: Boolean(t.selected),
    codec: t.codec as string | undefined,
    forced: Boolean(t.forced),
    default: Boolean(t.default),
    externalFilename: t['external-filename'] as string | undefined,
  }))
}

/** mpv 的 playlist → 播放列表条目 */
export function parsePlaylist(
  raw: Record<string, unknown>[]
): MpvPlaylistEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(p => ({
    url: p.filename as string | undefined,
    name: p.title as string | undefined,
  }))
}
