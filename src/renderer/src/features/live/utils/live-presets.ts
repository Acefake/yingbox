/**
 * 推荐直播源：直播页里一点就能订阅的公开播放列表。
 *
 * 清单只是静态数据，订阅走 useLiveSources().addUrl，与手动添加同一条路径；mirrors 是同一份列表的镜像，
 * 主地址拉不到时依次尝试（GitHub raw 在国内常被墙，jsDelivr 镜像兜底）。
 * 这些源来自公开项目，可用性随所在网络而变（部分只在 IPv6 下可用）；
 * 在海外网络拉不到不代表源失效，增删条目以国内实测为准（ADR-0003）。
 * 只收每天更新、频道地址以 HLS（m3u8）为主的列表；组播（/rtp/）、FLV 线路由播放区探测后交给 mpv。
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
  /** 同一份列表的镜像地址（主地址失败时依次尝试） */
  mirrors?: string[]
  /** 节目单地址（XMLTV，可选）；不给时用播放列表头里的 x-tvg-url */
  epgUrl?: string
  network: LivePresetNetwork
}

const freeze = (list: LivePreset[]): readonly LivePreset[] =>
  Object.freeze(list.map(p => Object.freeze(p)))

/** 推荐直播源清单（按推荐顺序） */
export const LIVE_PRESETS: readonly LivePreset[] = freeze([
  {
    id: 'vbskycn',
    name: 'vbskycn',
    description: '央视、卫视与地方台，每天自动测速更新',
    url: 'https://live.zbds.org/tv/iptv4.m3u',
    mirrors: [
      'https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u',
      'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
    ],
    network: 'ipv4',
  },
  {
    id: 'zhi35',
    name: 'zhi35',
    description: '地方台走 IPv4；央视为 IPv6 线路',
    url: 'https://live.zhi35.com/iptv.m3u',
    epgUrl: 'https://live.zhi35.com/epg.xml.gz',
    network: 'dual',
  },
  {
    id: 'fanmingming',
    name: 'fanmingming',
    description: '央视、卫视高清线路（北京移动等 IPv6 网络）',
    url: 'https://live.fanmingming.cn/tv/m3u/ipv6.m3u',
    epgUrl: 'https://live.fanmingming.cn/e.xml',
    network: 'ipv6',
  },
  {
    id: 'iptv-org',
    name: 'iptv-org',
    description: '全球公开项目的中国频道（英文台名，海外也能用）',
    url: 'https://iptv-org.github.io/iptv/countries/cn.m3u',
    mirrors: [
      'https://cdn.jsdelivr.net/gh/iptv-org/iptv@gh-pages/countries/cn.m3u',
    ],
    network: 'ipv4',
  },
])

/** 远程源地址若是某个推荐源（主地址或镜像），返回该推荐源的其余地址作为备用；否则空数组 */
export function presetMirrorsFor(url: string): string[] {
  const target = url.trim()
  const preset = LIVE_PRESETS.find(
    p => p.url === target || (p.mirrors ?? []).includes(target)
  )
  if (!preset) return []
  return [preset.url, ...(preset.mirrors ?? [])].filter(u => u !== target)
}

/** 网络要求的显示文案 */
export function networkLabel(network: LivePresetNetwork): string {
  if (network === 'dual') return 'IPv4 / IPv6'
  return network === 'ipv4' ? 'IPv4' : '仅 IPv6'
}

/**
 * 推荐源是否已订阅：已有远程源的地址与它的主地址或任一镜像相同（首尾空白忽略，与添加时一致）。
 * 名称、启用状态不影响判定；本地文件源不算。
 */
export function isPresetSubscribed(
  preset: LivePreset,
  sources: readonly LiveSource[]
): boolean {
  const urls = new Set(
    [preset.url, ...(preset.mirrors ?? [])].map(u => u.trim())
  )
  return sources.some(s => s.kind === 'url' && urls.has(s.location))
}
