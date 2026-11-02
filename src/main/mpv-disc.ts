/**
 * 光盘镜像（.iso）交给 mpv 的方式：mpv 不认普通文件路径形式的光盘镜像，要用 bd:// / dvd:// 打开，
 * 再用 --bluray-device / --dvd-device 指到镜像文件。蓝光还是 DVD 看镜像开头的文件系统目录项里有 BDMV 还是 VIDEO_TS。
 * 认不出时按普通文件处理（mpv 自己再试）。
 */
import { open } from 'node:fs/promises'

import { isDiscImage } from '../shared/disc-media'

/** 光盘镜像的打开方式。 */
export interface DiscSource {
  /** mpv 打开目标。 */
  target: 'bd://' | 'dvd://'
  /** 指向镜像文件的 mpv 选项名。 */
  option: 'bluray-device' | 'dvd-device'
  /** 镜像文件路径。 */
  device: string
}

/** 读镜像开头多少字节找目录项：ISO 9660 / UDF 的目录通常在最前面几 MB。 */
const HEAD_BYTES = 8 * 1024 * 1024

/** UDF 的文件名可能是 UTF-16BE，两种写法都找。 */
function containsName(head: Buffer, name: string): boolean {
  return (
    head.includes(name) || head.includes(Buffer.from(name, 'utf16le').swap16())
  )
}

/** 镜像开头里认出的光盘类型；两种都有（混合盘）按蓝光算。 */
export function discKindOf(head: Buffer): 'bluray' | 'dvd' | null {
  if (containsName(head, 'BDMV')) return 'bluray'
  if (containsName(head, 'VIDEO_TS')) return 'dvd'
  return null
}

/** 镜像对应的 mpv 打开方式；不是光盘镜像、读不了或认不出时返回 null。 */
export async function discSourceOf(
  filePath: string | undefined
): Promise<DiscSource | null> {
  if (!filePath || !isDiscImage(filePath)) return null
  const handle = await open(filePath, 'r').catch(() => null)
  if (!handle) return null
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0)
    const kind = discKindOf(head.subarray(0, bytesRead))
    if (kind === 'bluray')
      return { target: 'bd://', option: 'bluray-device', device: filePath }
    if (kind === 'dvd')
      return { target: 'dvd://', option: 'dvd-device', device: filePath }
    return null
  } finally {
    await handle.close()
  }
}
