/**
 * 文件识别用的 hash：文件前 16MB 的 MD5（不足 16MB 时取整个文件），流式读取，不整块进内存。
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'

import { MATCH_HASH_BYTES } from './rules'

/** 文件大小与前 16MB 的 MD5（小写十六进制） */
export async function hashForMatch(
  filePath: string
): Promise<{ hash: string; size: number }> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('不是文件')
  const hash = createHash('md5')
  const end = Math.min(stat.size, MATCH_HASH_BYTES) - 1
  if (end >= 0) {
    await new Promise<void>((resolve, reject) => {
      createReadStream(filePath, { start: 0, end })
        .on('data', chunk => hash.update(chunk))
        .on('end', () => resolve())
        .on('error', reject)
    })
  }
  return { hash: hash.digest('hex'), size: stat.size }
}
