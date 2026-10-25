/**
 * 媒体库条目的播放进度去向：带 library 标记（条目 id + 文件 id）的播放条目，进度只写片库数据库，
 * 不写本地的进度表 / 「已看完」集合（那两份只给在线等非媒体库条目用）。
 *
 * 播放器不认识媒体库：媒体库 feature 启动时用 setLibraryProgressSink 接上（features/library/progress），
 * 应用内播放器、mpv 会话、继续播放的「标记已看完」都经这里上报。无痕模式下不上报。
 */
import { isIncognito } from '@/features/incognito'

/** 播放条目上的媒体库标记（随继续播放记录持久化，须可 JSON 序列化）。 */
export interface LibraryRef {
  /** 电影或那一集的条目 id */
  itemId: number
  /** 播放的视频文件 id */
  fileId: number
}

/** 媒体库那一侧的实现。 */
export interface LibraryProgressSink {
  /** 续播位置（秒）：看完的从头（0）；不知道为 undefined（播放器再看本地进度表）。 */
  resumeAt(ref: LibraryRef): number | undefined
  /** 上报一次进度；ended 为播到结尾。 */
  report(
    ref: LibraryRef,
    position: number,
    duration: number,
    ended: boolean
  ): void
  /** 立即写出还没写的上报（关播放器、切集时）。 */
  flush(): void
}

let sink: LibraryProgressSink | null = null

/** 接上媒体库实现（只在应用入口调一次；返回断开函数，测试用）。 */
export function setLibraryProgressSink(next: LibraryProgressSink): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}

/** 是否是合法的媒体库标记（来自存储的旧记录可能没有或坏掉）。 */
export function isLibraryRef(value: unknown): value is LibraryRef {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<LibraryRef>
  return (
    Number.isSafeInteger(r.itemId) &&
    (r.itemId as number) > 0 &&
    Number.isSafeInteger(r.fileId) &&
    (r.fileId as number) > 0
  )
}

/** 媒体库条目的续播位置；不是媒体库条目或还不知道时为 undefined。 */
export function libraryResumeAt(ref: unknown): number | undefined {
  return isLibraryRef(ref) && sink ? sink.resumeAt(ref) : undefined
}

/**
 * 上报媒体库条目的进度。返回 true 表示这是媒体库条目（已交给片库，调用方不必再写本地进度表）；
 * 无痕模式下同样返回 true，但什么也不写。
 */
export function reportLibraryProgress(
  ref: unknown,
  position: number,
  duration: number,
  ended = false
): boolean {
  if (!isLibraryRef(ref)) return false
  if (!isIncognito()) sink?.report(ref, position, duration, ended)
  return true
}

/** 写出还没写的媒体库上报。 */
export function flushLibraryProgress(): void {
  sink?.flush()
}
