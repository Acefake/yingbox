import { describe, expect, it } from 'vitest'

import {
  MAX_PHOTOS,
  PHOTOS_TTL_MS,
  createDoubanPhotos,
  parseDoubanPhotos,
} from '../src/engine/online/douban-photos'
import { online } from '../src/shared/contract/online'
import type { NetClient } from '../src/shared/net/client'
import { HttpStatusError } from '../src/shared/net/client'

/**
 * 豆瓣剧照（详情页剧照条兜底）：rexxar photos 接口，横图优先、缓存、失败返回空数组、熔断。
 */

const photo = (id: number, width = 1600, height = 900): unknown => ({
  id: String(id),
  image: {
    large: {
      url: `https://img1.doubanio.com/view/photo/l/public/p${id}.jpg`,
      width,
      height,
    },
    normal: {
      url: `https://img1.doubanio.com/view/photo/m/public/p${id}.jpg`,
      width: width / 2,
      height: height / 2,
    },
  },
})

function fakeNet(reply: () => unknown): NetClient & {
  requests: { url: string; headers: Record<string, string> }[]
} {
  const requests: { url: string; headers: Record<string, string> }[] = []
  return {
    requests,
    open: () => Promise.reject(new Error('unused')),
    request: () => Promise.reject(new Error('unused')),
    getText: () => Promise.reject(new Error('unused')),
    async getJson<T>(url: string, req?: { headers?: Record<string, string> }) {
      requests.push({ url, headers: req?.headers ?? {} })
      const value = reply()
      if (value instanceof Error) throw value
      return value as T
    },
  }
}

describe('parseDoubanPhotos', () => {
  it('横图够 4 张时只要横图，缩略图取 normal、原图取 large', () => {
    const photos = parseDoubanPhotos({
      photos: [photo(1, 600, 900), photo(2), photo(3), photo(4), photo(5)],
    })
    expect(photos).toHaveLength(4)
    expect(photos[0]).toEqual({
      thumb: 'https://img1.doubanio.com/view/photo/m/public/p2.jpg',
      full: 'https://img1.doubanio.com/view/photo/l/public/p2.jpg',
    })
  })

  it('横图不足 4 张时连竖图一起，最多 20 张', () => {
    expect(
      parseDoubanPhotos({ photos: [photo(1, 600, 900), photo(2)] })
    ).toHaveLength(2)
    const many = Array.from({ length: 40 }, (_, i) => photo(i + 1))
    expect(parseDoubanPhotos({ photos: many })).toHaveLength(MAX_PHOTOS)
  })

  it('不是剧照列表抛错；地址不是 https 的丢掉', () => {
    expect(() => parseDoubanPhotos({ msg: 'need_login' })).toThrow()
    expect(
      parseDoubanPhotos({
        photos: [{ image: { large: { url: 'javascript:alert(1)' } } }],
      })
    ).toEqual([])
  })
})

describe('createDoubanPhotos', () => {
  it('rexxar 地址、移动 UA 与 Referer；1 小时内走缓存', async () => {
    let t = 0
    const net = fakeNet(() => ({ photos: [photo(1)] }))
    const service = createDoubanPhotos({ net, now: () => t })
    expect(await service.get('1292052', 'tv')).toHaveLength(1)
    await service.get('1292052', 'tv')
    expect(net.requests).toHaveLength(1)
    expect(net.requests[0].url).toBe(
      'https://m.douban.com/rexxar/api/v2/tv/1292052/photos?start=0&count=40'
    )
    expect(net.requests[0].headers.Referer).toBe('https://m.douban.com/')
    expect(net.requests[0].headers['User-Agent']).toContain('iPhone')
    t = PHOTOS_TTL_MS + 1
    await service.get('1292052', 'tv')
    expect(net.requests).toHaveLength(2)
  })

  it('失败返回空数组、不缓存；连续 3 次失败后冷却期内不发请求', async () => {
    const net = fakeNet(() => new HttpStatusError(403))
    const service = createDoubanPhotos({ net })
    for (let i = 0; i < 3; i++)
      expect(await service.get('1', 'movie')).toEqual([])
    expect(await service.get('1', 'movie')).toEqual([])
    expect(net.requests).toHaveLength(3)
  })

  it('契约：ID 必须是数字，kind 缺省 movie', () => {
    const parse = online.calls.doubanPhotos.parse
    expect(parse(['123'])).toEqual(['123', 'movie'])
    expect(parse(['123', 'tv'])).toEqual(['123', 'tv'])
    expect(() => parse(['1/../2'])).toThrow()
    expect(() => parse(['1', 'show'])).toThrow()
  })
})
