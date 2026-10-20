/**
 * 下载重试工具：带指数退避的下载封装，供 Movie / TV 两侧刮削逻辑共用，避免各自维护一份重试逻辑。
 */

/** 判断错误是否值得重试 */
function isRetryableError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase()
  return (
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('socket hang up') ||
    lower.includes('429') ||
    lower.includes('503')
  )
}

/** 判断错误是否为永久性失败（不应重试） */
function isPermanentError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase()
  return (
    lower.includes('eperm') ||
    lower.includes('permission') ||
    lower.includes('404') ||
    lower.includes('403') ||
    lower.includes('enoent')
  )
}

/** 带重试和指数退避的下载函数 */
const tryDownload = async (
  url: string,
  path: string,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<{ success: boolean; error?: string }> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await window.api.http.download(url, path)
      if (result.success) return result

      const errorMsg = result.error || ''
      if (isPermanentError(errorMsg)) return result
      if (attempt === maxRetries || !isRetryableError(errorMsg)) return result

      const delay = baseDelay * Math.pow(2, attempt - 1)
      console.warn(
        `下载失败，${delay}ms 后重试 (${attempt}/${maxRetries}): ${path}`
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : ''
      if (isPermanentError(errorMsg)) {
        return { success: false, error: errorMsg }
      }
      if (attempt < maxRetries && isRetryableError(errorMsg)) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        console.warn(
          `下载异常，${delay}ms 后重试 (${attempt}/${maxRetries}): ${path}`
        )
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      return { success: false, error: errorMsg || '未知错误' }
    }
  }
  return { success: false, error: '下载失败' }
}

export async function downloadWithRetry(
  url: string,
  filePath: string
): Promise<void> {
  const result = await tryDownload(url, filePath)
  if (!result.success)
    throw new Error(`下载失败 [${filePath}]: ${result.error || '未知错误'}`)
}

export async function finishDownloads<T>(jobs: Promise<T>[]): Promise<void> {
  const results = await Promise.allSettled(jobs)
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
