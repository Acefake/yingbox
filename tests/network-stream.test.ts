import { afterEach, expect, it, vi } from 'vitest'
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34' }],
}))
import { publicFetch } from '../src/main/network'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('公开附件持续传输超过 30 秒，由调用方取消信号控制，不增加总时限', async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  vi.stubGlobal(
    'fetch',
    async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            const timer = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('complete'))
              controller.close()
            }, 35000)
            init.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                controller.error(new Error('aborted'))
              },
              { once: true }
            )
          },
        })
      )
  )
  const response = await publicFetch(
    'https://github.com/o/r/releases/download/v1/file',
    { signal: caller.signal }
  )
  const body = response.text()
  await vi.advanceTimersByTimeAsync(35000)
  await expect(body).resolves.toBe('complete')
})
