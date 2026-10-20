/**
 * 文件指纹：OpenSubtitles moviehash（文件大小 + 头尾各 64 KiB），复用 P1 的纯函数实现。
 * 用于移动识别，P3 也拿它向 OpenSubtitles 查片。
 */
import { open } from 'node:fs/promises'
import { computeMovieHash } from '../../../shared/library/identify'

/** 计算文件指纹；文件读不到时返回 undefined。 */
export async function fingerprintFile(
  path: string
): Promise<string | undefined> {
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
    await handle?.close()
  }
}
