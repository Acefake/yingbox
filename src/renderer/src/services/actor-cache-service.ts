/**
 * 全局演员图片缓存：同一演员（按 tmdbid 或姓名）在不同电影间只下载一次，
 * 命中缓存后直接拷贝到目标 .actors 目录，减少重复网络下载。
 */
import { downloadWithRetry } from './download-service'

let cacheDirPromise: Promise<string | null> | null = null

async function resolveActorCacheDir(): Promise<string | null> {
  if (!cacheDirPromise) {
    cacheDirPromise = (async () => {
      try {
        const userData = await window.api.app.getUserDataPath()
        if (!userData) return null
        const dir = await window.api.path.join(userData, 'actor-image-cache')
        const mk = await window.api.file.mkdir(dir)
        if (!mk.success) {
          console.warn('创建全局演员图片缓存目录失败:', mk.error)
          return null
        }
        return dir
      } catch (error) {
        console.warn('解析全局演员图片缓存目录失败:', error)
        return null
      }
    })()
  }
  return cacheDirPromise
}

/**
 * 获取演员照片：优先从全局缓存复制到目标路径；未命中则下载一次并写入缓存，再复制到目标路径。
 * 任何异常都会兜底为直接下载到目标路径，保证缓存层故障不会导致整个刮削失败。
 * @param cacheKey 稳定的缓存 key（TMDB 演员使用 tmdbid）
 */
export async function fetchActorPhoto(
  cacheKey: string,
  photoUrl: string,
  destPath: string
): Promise<void> {
  const cacheDir = await resolveActorCacheDir()
  if (!cacheDir) {
    await downloadWithRetry(photoUrl, destPath)
    return
  }

  const cachePath = await window.api.path.join(cacheDir, `${cacheKey}.jpg`)
  const exists = await window.api.file.exists(cachePath)
  if (exists.success && exists.exists) {
    const copyResult = await window.api.file.copy(cachePath, destPath)
    if (copyResult.success) return
  }

  await downloadWithRetry(photoUrl, cachePath)
  const copyResult = await window.api.file.copy(cachePath, destPath)
  if (!copyResult.success) {
    await downloadWithRetry(photoUrl, destPath)
  }
}
