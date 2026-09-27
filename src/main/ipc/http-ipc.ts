import { ipcMain } from 'electron'
import { downloadFile, fetchHttp, readLimited } from '../http-client'

/** 图片代理的大小上限（base64 后约放大 1/3，控制在可接受的内存占用内） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function registerHttpIpc(): void {
  ipcMain.handle(
    'http:fetch',
    async (
      _,
      url: string,
      options: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      } = {}
    ) => {
      try {
        const method = (options.method ?? 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') {
          throw new Error('仅支持 GET/POST/HEAD 方法')
        }
        const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30000, 1000), 120000)
        const response = await fetchHttp(
          url,
          { method, headers: options.headers, body: options.body },
          timeoutMs
        )
        const text = (await readLimited(response)).toString('utf-8')
        try {
          return { success: true, status: response.status, data: JSON.parse(text) }
        } catch {
          return { success: true, status: response.status, data: text, raw: true }
        }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('http:fetchImage', async (_, url: string, referer?: string) => {
    try {
      const response = await fetchHttp(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: referer || `${new URL(url).origin}/`,
            Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        15000
      )
      const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      if (!contentType.startsWith('image/')) {
        await response.body?.cancel()
        throw new Error('响应不是图片')
      }
      // 声明长度超限时直接放弃，避免把大响应读进内存
      const declared = Number(response.headers.get('content-length') || 0)
      if (declared > MAX_IMAGE_BYTES) {
        await response.body?.cancel()
        throw new Error('图片超过大小上限')
      }
      const buffer = await readLimited(response, MAX_IMAGE_BYTES)
      return { success: true, data: `data:${contentType};base64,${buffer.toString('base64')}` }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('http:download', async (_, url: string, filePath: string) => {
    try {
      await downloadFile(url, filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
