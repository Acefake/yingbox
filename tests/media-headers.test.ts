import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'

import { blockPlaceholderImages } from '../src/main/media-headers'

/** 桌面端渲染层直连远程图时，重定向到图床占位图的那一跳被拦掉，<img> 走 error。 */
describe('blockPlaceholderImages', () => {
  type Listener = (
    details: { url: string },
    callback: (response: { cancel: boolean }) => void
  ) => void
  let listener: Listener | undefined
  let filter: { urls: string[] } | undefined
  const session = {
    webRequest: {
      onBeforeRequest: (f: { urls: string[] }, l: Listener) => {
        filter = f
        listener = l
      },
    },
  } as unknown as Session
  blockPlaceholderImages(session)

  const cancelled = (url: string): boolean => {
    const callback = vi.fn()
    listener!({ url }, callback)
    return callback.mock.calls[0][0].cancel
  }

  it('只监听 DMM 图床', () => {
    expect(filter?.urls).toEqual([
      'https://*.dmm.com/*',
      'https://*.dmm.co.jp/*',
    ])
  })

  it('占位图取消，正常剧照放行', () => {
    expect(
      cancelled(
        'https://imgsrc.dmm.com/pics/mono/movie/n/now_printing/now_printing.jpg'
      )
    ).toBe(true)
    expect(
      cancelled(
        'https://pics.dmm.co.jp/digital/video/pgd00630/pgd00630jp-1.jpg'
      )
    ).toBe(false)
  })
})
