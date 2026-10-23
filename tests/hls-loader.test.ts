import Hls, { type LoaderConfiguration, type LoaderContext } from 'hls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopHlsLoader } from '../src/renderer/src/features/player/utils/hls-loader'
import { STREAM_RESPONSE_URL, streamUrl } from '../src/shared/stream-url'

afterEach(() => vi.unstubAllGlobals())
const config = (): LoaderConfiguration => ({
  loadPolicy: Hls.DefaultConfig.fragLoadPolicy.default,
  timeout: 1000,
  maxRetry: 0,
  retryDelay: 0,
  maxRetryDelay: 0,
})

describe('桌面 HLS 加载器', () => {
  it('分片走专用协议并保留 Range；回调仍拿到原始上下文与最终远端地址', async () => {
    vi.stubGlobal('self', globalThis)
    const fetch = vi.fn(
      async (_request: Request) =>
        new Response('BCD', {
          headers: {
            [STREAM_RESPONSE_URL]: 'https://cdn.test/final/list.m3u8',
          },
        })
    )
    vi.stubGlobal('fetch', fetch)
    const loader = new DesktopHlsLoader(Hls.DefaultConfig)
    const context: LoaderContext = {
      url: 'https://cdn.test/start.m3u8',
      responseType: 'arraybuffer',
      rangeStart: 1,
      rangeEnd: 4,
    }
    try {
      const result = await new Promise<{ url: string; data?: unknown }>(
        (resolve, reject) =>
          loader.load(context, config(), {
            onSuccess: (response, _stats, actualContext) => {
              expect(actualContext).toBe(context)
              resolve(response)
            },
            onError: reject,
            onTimeout: () => reject(new Error('timeout')),
          })
      )
      expect(result.url).toBe('https://cdn.test/final/list.m3u8')
      expect(Buffer.from(result.data as ArrayBuffer).toString()).toBe('BCD')
      const request = fetch.mock.calls[0][0] as Request
      expect(request.url).toBe(streamUrl(context.url))
      expect(request.headers.get('range')).toBe('bytes=1-3')
    } finally {
      loader.destroy()
    }
  })
})
