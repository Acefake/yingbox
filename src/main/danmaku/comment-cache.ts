/**
 * 弹幕内容的磁盘缓存：userData/danmaku/comments/<episodeId>.json，保存 7 天。
 * 读到过期或损坏的文件当作没有；写入走 atomicWrite。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { DanmakuComment } from '../../shared/contract/danmaku'
import { atomicWrite } from '../file-operations'
import { isCacheFresh } from './rules'

/** 缓存文件结构 */
interface CacheFile {
  savedAt: number
  comments: DanmakuComment[]
}

/** 一个缓存目录 */
export interface CommentCache {
  read(episodeId: number): Promise<DanmakuComment[] | null>
  write(episodeId: number, comments: DanmakuComment[]): Promise<void>
}

/**
 * 打开缓存目录。
 * @param dir 缓存目录（不存在时写入前创建）
 * @param now 当前时间（测试可替换）
 */
export function createCommentCache(
  dir: string,
  now: () => number = Date.now
): CommentCache {
  const fileOf = (episodeId: number): string => join(dir, `${episodeId}.json`)
  return {
    async read(episodeId) {
      try {
        const data = JSON.parse(
          await fs.readFile(fileOf(episodeId), 'utf8')
        ) as Partial<CacheFile>
        if (!isCacheFresh(data.savedAt, now()) || !Array.isArray(data.comments))
          return null
        return data.comments
      } catch {
        return null
      }
    },
    async write(episodeId, comments) {
      await fs.mkdir(dir, { recursive: true })
      const file: CacheFile = { savedAt: now(), comments }
      await atomicWrite(fileOf(episodeId), JSON.stringify(file))
    },
  }
}
