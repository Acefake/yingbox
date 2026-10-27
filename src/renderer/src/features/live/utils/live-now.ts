/**
 * 首页「正在直播」一排的纯规则：收藏频道（按收藏顺序）连同当前节目、时段、进度与剩余时间。
 * 没有收藏、收藏的频道都不在当前直播源里时为空数组（整排隐藏）。
 */
import type { EpgProgramme } from '../../../../../shared/contract/iptv'
import { formatClock, nowPlaying } from './epg-rules'
import type { LiveChannel } from './playlist-parse'

/** 一排最多几张 */
export const LIVE_NOW_LIMIT = 8

/** 「正在直播」的一张卡 */
export interface LiveNowCard {
  channel: LiveChannel
  /** 「CCTV-9 纪录 · 自然的力量」；没有节目单时只有频道名 */
  title: string
  /** 「20:00–21:00 · 还剩 31 分钟」；没有节目单时「正在直播」 */
  subtitle: string
  /** 播出进度 0–1；没有节目单时为 null（不画进度条） */
  progress: number | null
}

/** 剩余时间：「还剩 31 分钟」「还剩 1 小时 40 分」 */
export function remainingText(minutes: number): string {
  if (minutes < 60) return `还剩 ${minutes} 分钟`
  const m = minutes % 60
  return `还剩 ${Math.floor(minutes / 60)} 小时${m ? ` ${m} 分` : ''}`
}

/**
 * 收藏频道的当前节目卡。
 * @param channels 启用的源合并后的频道
 * @param favorites 收藏的频道 id（按收藏顺序）
 * @param programmes 频道 id → 节目单（按开始时间排序）
 * @param now 当前时间（毫秒）
 */
export function liveNowCards(
  channels: readonly LiveChannel[],
  favorites: Iterable<string>,
  programmes: Readonly<Record<string, EpgProgramme[]>>,
  now: number,
  limit = LIVE_NOW_LIMIT
): LiveNowCard[] {
  const byId = new Map(channels.map(channel => [channel.id, channel]))
  const cards: LiveNowCard[] = []
  for (const id of favorites) {
    const channel = byId.get(id)
    if (!channel) continue
    const status = nowPlaying(programmes[id], now)
    cards.push(
      status
        ? {
            channel,
            title: `${channel.name} · ${status.programme.title}`,
            subtitle: `${formatClock(status.programme.start)}–${formatClock(
              status.programme.stop
            )} · ${remainingText(status.remainingMinutes)}`,
            progress: status.progress,
          }
        : {
            channel,
            title: channel.name,
            subtitle: '正在直播',
            progress: null,
          }
    )
    if (cards.length >= limit) break
  }
  return cards
}
