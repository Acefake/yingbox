/**
 * 独立播放窗口的播放队列：主窗口发来的载荷（或地址栏参数）在这里校验并整理成队列。
 * 外部数据只在这里解析，之后窗口内部只处理整理好的 PopoutQueue。
 */

/** 单个播放条目（集 / 文件 / 备用线路） */
export type PlaylistEntry = {
  url?: string
  filePath?: string
  name?: string
  ext?: Record<string, unknown>
  siteName?: string
}

/** 主窗口发来的播放载荷（字段都可能缺失或类型不对） */
export type PlayerPayload = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
  playlist?: PlaylistEntry[]
  index?: number
  fallbacks?: PlaylistEntry[]
}

/** 整理后的播放队列 */
export interface PopoutQueue {
  /** 当前线路的播放队列（自动连播用）；单条目时长度为 1 */
  playlist: PlaylistEntry[]
  /** 起始集下标 */
  position: number
  /** 同集备用线路（失败自动换线路用） */
  fallbacks: PlaylistEntry[]
  /** 窗口默认标题 */
  title: string
  poster: string
  /** 起始续播秒数（未给出时为 undefined，用已存进度） */
  startAt?: number
  /** 调用方已解析好的起始集地址（复用，避免二次解析） */
  seededUrl?: string
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** 把载荷整理成队列；既没有列表也没有地址 / 文件时返回 null（忽略这次载荷） */
export function normalizePlayerPayload(
  payload: PlayerPayload
): PopoutQueue | null {
  const filePath = text(payload.filePath)
  const url = text(payload.url)
  const incoming = Array.isArray(payload.playlist)
    ? payload.playlist.filter(Boolean)
    : []

  let playlist: PlaylistEntry[]
  let position = 0
  if (incoming.length) {
    playlist = incoming
    const rawIndex = Number(payload.index)
    if (
      Number.isInteger(rawIndex) &&
      rawIndex >= 0 &&
      rawIndex < incoming.length
    )
      position = rawIndex
  } else if (url || filePath) {
    // 单条目：等价于长度为 1 的队列，仍记录进度，但不触发连播
    playlist = [{ ...(url ? { url } : {}), ...(filePath ? { filePath } : {}) }]
  } else {
    return null
  }

  return {
    playlist,
    position,
    fallbacks: Array.isArray(payload.fallbacks)
      ? payload.fallbacks.filter(Boolean)
      : [],
    title: text(payload.title) || '正在播放',
    poster: text(payload.poster),
    startAt:
      typeof payload.startAt === 'number' && Number.isFinite(payload.startAt)
        ? Math.max(0, payload.startAt)
        : undefined,
    seededUrl: url || undefined,
  }
}

/** 条目显示名：优先 name，其次文件名，最后用窗口默认标题 */
export function playlistEntryLabel(
  entry: PlaylistEntry | null | undefined,
  fallback: string
): string {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  if (name) return name
  if (entry?.filePath) return entry.filePath.split(/[/\\]/).pop() || fallback
  return fallback
}
