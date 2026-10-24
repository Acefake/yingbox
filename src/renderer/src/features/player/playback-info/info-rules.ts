/**
 * 播放信息面板的纯规则：把一次采样（<video>、hls.js、mpv 状态）整理成「标签 / 值」行。
 * 不碰 DOM，便于单测；采样与面板见 playback-info.ts。
 */
import type { MpvStatus } from '@shared/mpv'

/** 面板上的一行 */
export interface InfoRow {
  label: string
  value: string
}

/** hls.js 的一个档位（只取用到的字段） */
export interface HlsLevelInfo {
  width?: number
  height?: number
  bitrate?: number
  videoCodec?: string
  audioCodec?: string
}

/** hls.js 的当前状态 */
export interface HlsInfo {
  levels: HlsLevelInfo[]
  /** 正在播放的档位下标；-1 未知 */
  current: number
  /** 是否自动切档 */
  auto: boolean
  /** 带宽估计（bit/s） */
  bandwidth?: number
}

/** 一次采样 */
export interface InfoSample {
  url: string
  width: number
  height: number
  currentTime: number
  /** 已缓冲区间 */
  buffered: Array<[start: number, end: number]>
  /** getVideoPlaybackQuality()；不支持时缺省 */
  quality?: { dropped: number; total: number }
  /** 码率估算（bit/s），由前后两次已解码字节数换算；拿不到时缺省 */
  bitrate?: number
  hls?: HlsInfo
}

const SOURCE_KINDS: Array<[RegExp, string]> = [
  [/^local:/i, '本地文件'],
  [/^blob:/i, 'Blob（内存）'],
  [/\/media\/files\b/i, '媒体库服务器'],
  [/\.m3u8(?:$|[?#])/i, 'HLS（m3u8）'],
  [/\.mpd(?:$|[?#])/i, 'DASH（mpd）'],
  [/\.flv(?:$|[?#])/i, 'FLV 直链'],
  [/^https?:/i, 'HTTP 直链'],
  // mpv 的 path 是文件系统路径：Windows 盘符、UNC、POSIX 绝对路径、file://
  [/^(?:[a-z]:[\\/]|\\\\|\/|file:)/i, '本地文件'],
]

/**
 * 播放地址的类型。
 * @param url 实际播放地址
 */
export function sourceKind(url: string): string {
  for (const [pattern, label] of SOURCE_KINDS) {
    if (pattern.test(url)) return label
  }
  return '其他'
}

/**
 * 地址里的文件扩展名（容器格式），没有就返回空串。
 * @param url 实际播放地址
 */
export function containerOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? ''
  const match = /\.([a-z0-9]{2,5})$/i.exec(decodeURIComponent(path))
  return match ? match[1].toUpperCase() : ''
}

/**
 * 码率文案：「4.20 Mbps」「850 kbps」。
 * @param bps 比特每秒
 */
export function formatBitrate(bps: number | undefined): string {
  if (bps === undefined || !Number.isFinite(bps) || bps <= 0) return '—'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

/**
 * 由前后两次已解码字节数估算码率（bit/s）；数据不足或计数被重置时返回 undefined。
 * @param prevBytes 上次的字节数
 * @param nextBytes 本次的字节数
 * @param elapsedMs 两次之间的毫秒数
 */
export function estimateBitrate(
  prevBytes: number,
  nextBytes: number,
  elapsedMs: number
): number | undefined {
  if (!(elapsedMs > 0)) return undefined
  const delta = nextBytes - prevBytes
  if (!Number.isFinite(delta) || delta <= 0) return undefined
  return (delta * 8 * 1000) / elapsedMs
}

/**
 * 当前位置往后已缓冲的秒数。
 * @param buffered 已缓冲区间
 * @param time 当前位置
 */
export function bufferAhead(
  buffered: Array<[number, number]>,
  time: number
): number {
  for (const [start, end] of buffered) {
    if (time >= start - 0.25 && time <= end) return Math.max(0, end - time)
  }
  return 0
}

/**
 * HLS 档位文案：「1080p · 4.20 Mbps（自动，3/5）」。
 * @param hls hls.js 状态
 */
export function hlsLevelText(hls: HlsInfo): string {
  const level = hls.levels[hls.current]
  if (!level) return hls.levels.length ? `共 ${hls.levels.length} 档` : '—'
  const parts = [
    level.height ? `${level.height}p` : '',
    level.bitrate ? formatBitrate(level.bitrate) : '',
  ].filter(Boolean)
  const where = `${hls.auto ? '自动，' : ''}${hls.current + 1}/${hls.levels.length}`
  return `${parts.join(' · ') || '未知'}（${where}）`
}

/**
 * 编码文案：HLS 档位声明的编码；其余格式浏览器不提供，给出容器格式。
 * @param sample 采样
 */
export function codecText(sample: InfoSample): string {
  const level = sample.hls?.levels[sample.hls.current]
  const codecs = [level?.videoCodec, level?.audioCodec].filter(Boolean)
  if (codecs.length) return codecs.join(' / ')
  const container = containerOf(sample.url)
  return container ? `未知（容器 ${container}）` : '未知'
}

/**
 * 丢帧文案：「3 / 12045（0.02%）」。
 * @param quality getVideoPlaybackQuality 的结果
 */
export function droppedText(quality: InfoSample['quality']): string {
  if (!quality) return '—'
  const { dropped, total } = quality
  const pct = total > 0 ? `（${((dropped / total) * 100).toFixed(2)}%）` : ''
  return `${dropped} / ${total}${pct}`
}

/**
 * 内置播放器一次采样对应的面板行。
 * @param sample 采样
 */
export function infoRows(sample: InfoSample): InfoRow[] {
  const level = sample.hls?.levels[sample.hls.current]
  const rows: InfoRow[] = [
    { label: '地址类型', value: sourceKind(sample.url) },
    { label: '编码', value: codecText(sample) },
    {
      label: '分辨率',
      value:
        sample.width && sample.height
          ? `${sample.width}×${sample.height}`
          : '—',
    },
    {
      label: '码率',
      value: sample.bitrate
        ? `≈ ${formatBitrate(sample.bitrate)}`
        : level?.bitrate
          ? `${formatBitrate(level.bitrate)}（档位标称）`
          : '—',
    },
    {
      label: '缓冲',
      value: `${bufferAhead(sample.buffered, sample.currentTime).toFixed(1)} 秒`,
    },
    { label: '丢帧', value: droppedText(sample.quality) },
  ]
  if (sample.hls) {
    rows.push({ label: 'HLS 档位', value: hlsLevelText(sample.hls) })
    rows.push({ label: '网速估计', value: formatBitrate(sample.hls.bandwidth) })
  }
  return rows
}

/**
 * mpv 正在播放时可读到的信息行（来自主进程推送的 MpvStatus）；没在运行时为空。
 * @param status mpv 状态
 */
export function mpvInfoRows(status: MpvStatus): InfoRow[] {
  if (!status.running) return []
  const selected = (type: 'video' | 'audio'): string =>
    status.tracks.find(t => t.type === type && t.selected)?.codec ?? ''
  const codecs = [selected('video'), selected('audio')].filter(Boolean)
  const rows: InfoRow[] = [
    { label: '编码', value: codecs.length ? codecs.join(' / ') : '—' },
    {
      label: '分辨率',
      value:
        status.videoWidth && status.videoHeight
          ? `${status.videoWidth}×${status.videoHeight}`
          : '—',
    },
  ]
  if (status.vsr && status.vsrWidth && status.vsrHeight) {
    rows.push({
      label: '超分',
      value: `RTX VSR → ${status.vsrWidth}×${status.vsrHeight}`,
    })
  }
  if (status.path)
    rows.push({ label: '地址类型', value: sourceKind(status.path) })
  return rows
}
