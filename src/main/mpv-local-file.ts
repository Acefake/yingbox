import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** 检查本地媒体路径，避免将目录或失效路径交给 mpv。 */
export async function validateMpvLocalFile(filePath?: string): Promise<void> {
  if (!filePath || !isAbsolute(filePath)) return
  let file
  try {
    file = await stat(filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      throw new Error(
        `视频文件不存在：${filePath}。请刷新媒体库或检查文件是否已移动`
      )
    throw new Error(`无法访问视频文件：${filePath}。请检查媒体库路径和访问权限`)
  }
  if (!file.isFile())
    throw new Error(`播放路径不是视频文件：${filePath}。请刷新媒体库`)
}
