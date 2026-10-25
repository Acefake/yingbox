/**
 * 推荐直播源：直播页里一点就能订阅的公开播放列表。
 *
 * 清单只是静态数据，订阅走 useLiveSources().addUrl，与手动添加同一条路径。
 * 这些源来自公开项目，可用性随所在网络而变（部分只在 IPv6 下可用）；
 * 在海外网络拉不到不代表源失效，增删条目以国内实测为准（ADR-0003）。
 */
import type { LiveSource } from './live-rules'

/** 源对网络的要求：dual 双栈、ipv4 仅 IPv4 线路、ipv6 仅 IPv6 线路 */
export type LivePresetNetwork = 'dual' | 'ipv4' | 'ipv6'

/** 一个推荐直播源 */
export interface LivePreset {
  /** 稳定标识，列表 key 用 */
  id: string
  /** 显示名称，也是订阅后直播源的名称 */
  name: string
  /** 一句话简述（覆盖哪些频道） */
  description: string
  /** m3u 播放列表地址 */
  url: string
  /** 节目单地址（XMLTV，可选）；不给时用播放列表头里的 x-tvg-url */
  epgUrl?: string
  network: LivePresetNetwork
}

const freeze = (list: LivePreset[]): readonly LivePreset[] =>
  Object.freeze(list.map(p => Object.freeze(p)))

/** 推荐直播源清单（按推荐顺序） */
export const LIVE_PRESETS: readonly LivePreset[] = freeze([
  {
    id: 'zhi35',
    name: 'zhi35',
    description: '央视与各地卫视',
    url: 'https://live.zhi35.com/iptv.m3u',
    epgUrl: 'https://live.zhi35.com/epg.xml.gz',
    network: 'dual',
  },
  {
    id: 'vbskycn',
    name: 'vbskycn',
    description: '央视、卫视与地方台',
    url: 'https://live.zbds.org/tv/iptv4.m3u',
    network: 'ipv4',
  },
  {
    id: 'guovin',
    name: 'Guovin iptv-api',
    description: '自动测速筛选的央视、卫视',
    url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u',
    network: 'ipv4',
  },
  {
    id: 'fanmingming',
    name: 'fanmingming',
    description: '央视、卫视高清线路',
    url: 'https://live.fanmingming.cn/tv/m3u/ipv6.m3u',
    epgUrl: 'https://live.fanmingming.cn/e.xml',
    network: 'ipv6',
  },
])

/** 网络要求的显示文案 */
export function networkLabel(network: LivePresetNetwork): string {
  if (network === 'dual') return 'IPv4 / IPv6'
  return network === 'ipv4' ? 'IPv4' : '仅 IPv6'
}

/**
 * 推荐源是否已订阅：已有远程源的地址与它相同（首尾空白忽略，与添加时一致）。
 * 名称、启用状态不影响判定；本地文件源不算。
 */
export function isPresetSubscribed(
  preset: LivePreset,
  sources: readonly LiveSource[]
): boolean {
  const url = preset.url.trim()
  return sources.some(s => s.kind === 'url' && s.location === url)
}
