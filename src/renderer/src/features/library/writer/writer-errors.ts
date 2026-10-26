/**
 * 写出 / 整理失败的提示文案（纯函数）。
 *
 * 引擎在任务结束时推 writer-progress（finished + failed / error），error 是 Node 的原始报错
 * （如 `EROFS: read-only file system, open '/media/…'`）。NAS 上最常见的是媒体目录只读挂载或没有写权限，
 * 这里译成一句用户能照着处理的话。
 */
import type { WriterProgressEvent } from '../../../../../shared/library/ipc'

const VERBS: Record<WriterProgressEvent['mode'], string> = {
  write: '写出 NFO 与图片',
  organize: '整理文件',
  undo: '撤销整理',
}

/** Node 文件系统报错 → 原因。认不出的原样返回（截断）。 */
export function fsErrorReason(message: string): string {
  if (/\bEROFS\b/.test(message))
    return '挂载是只读的（Docker 里媒体目录要去掉 :ro 才能写）'
  if (/\b(EACCES|EPERM)\b/.test(message))
    return '没有写权限（检查媒体目录的属主与权限）'
  if (/\bENOSPC\b/.test(message)) return '磁盘空间不足'
  return message.length > 160 ? `${message.slice(0, 160)}…` : message
}

/** 任务结束事件 → 失败提示；没有失败时为 null。 */
export function writerFailureText(event: WriterProgressEvent): string | null {
  if (!event.finished || (!event.failed && !event.error)) return null
  const count = event.failed ? ` ${event.failed} 个` : ''
  const reason = event.error ? `：${fsErrorReason(event.error)}` : ''
  return `${VERBS[event.mode]}失败${count}${reason}`
}
