/**
 * 媒体库前端访问引擎的唯一入口：window.api.library（preload 注入）。
 *
 * 网页版、旧版 preload 没有它，调用方据此显示“仅桌面版可用”的空状态。
 */
import type {
  LibraryBridge,
  LibraryWriterBridge,
} from '../../../../../shared/library/ipc'

/** 当前窗口的媒体库 bridge；不在 Electron 里时为 null。 */
export function libraryBridge(): LibraryBridge | null {
  return (typeof window !== 'undefined' && window.api?.library) || null
}

/**
 * 写出层 bridge（NFO / 图片 / 整理）。网页版或旧版 preload 没有它时返回 null，界面把相关入口置灰。
 */
export function writerBridge(): LibraryWriterBridge | null {
  return libraryBridge()?.writer ?? null
}

/** 引擎错误消息形如 “[library:code] 原因”，界面只显示原因。 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^\[library:[a-z-]+\]\s*/, '')
}
