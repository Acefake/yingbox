/**
 * 文件指纹：OpenSubtitles moviehash（文件大小 + 头尾各 64 KiB），复用 P1 的纯函数实现。
 * 用于移动识别，P3 也拿它向 OpenSubtitles 查片。
 */
import { open } from 'node:fs/promises'
import { computeMovieHash } from '../../../shared/library/identify'

/**
 * 单个文件的读取时限：挂载的网盘（CloudDrive2 之类）上读头尾常要几秒，卡住时系统调用可能一直不返回，
 * 没有时限的话这条后台任务会永远占着队列的一个并发位置，后面的任务全在排队。
 */
export const FINGERPRINT_TIMEOUT_MS = 15_000

/** 给一个 Promise 加时限：到点还没结果就当失败（undefined），底层调用留给系统自己收尾。 */
export function withTimeout<T>(
  task: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
}

async function hashOf(path: string): Promise<string | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const fh = handle
    return await computeMovieHash({
      size,
      read: async (offset, length) => {
        const buffer = new Uint8Array(length)
        const { bytesRead } = await fh.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      },
    })
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** 计算文件指纹；文件读不到、读超时时返回 undefined。 */
export function fingerprintFile(
  path: string,
  timeoutMs = FINGERPRINT_TIMEOUT_MS
): Promise<string | undefined> {
  return withTimeout(hashOf(path), timeoutMs)
}
