/**
 * 媒体库前端访问引擎的唯一入口：window.api.library（preload 注入）。
 *
 * 网页版、旧版 preload 没有它，调用方据此显示“仅桌面版可用”的空状态。
 */
import type { LibraryBridge } from '../../../../../shared/library/ipc'

import type { LibraryWriterBridge } from '../writer/writer-contract'

/** 当前窗口的媒体库 bridge；不在 Electron 里时为 null。 */
export function libraryBridge(): LibraryBridge | null {
  return (typeof window !== 'undefined' && window.api?.library) || null
}

/**
 * 写出层 bridge（P5）。P5 合并前 preload 没有 writer，返回 null，界面把相关按钮置灰。
 *
 * TODO(P5)：合并后 LibraryBridge 自带 writer 字段，这里的断言可以去掉。
 */
export function writerBridge(): LibraryWriterBridge | null {
  const library = libraryBridge() as
    | (LibraryBridge & { writer?: LibraryWriterBridge })
    | null
  return library?.writer ?? null
}

/** 引擎错误消息形如 “[library:code] 原因”，界面只显示原因。 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^\[library:[a-z-]+\]\s*/, '')
}
