import { describe, expect, it, vi } from 'vitest'
import {
  createDoubanMetadata,
  parseDoubanMetadata,
} from '../src/engine/online/douban-metadata'
import { online } from '../src/shared/contract/online'

const subject = {
  id: '1292052',
  title: '肖申克的救赎',
  intro: '简介',
  year: '1994',
  rating: { value: 9.7, count: 100 },
  pic: { large: 'https://img1.doubanio.com/poster.jpg' },
  durations: ['142分钟'],
  directors: [{ name: '导演' }],
  actors: [{ name: '演员' }],
}

describe('豆瓣独立元数据', () => {
  it('无需 TMDB 即可映射简介、评分、时长和演职员', () => {
    expect(parseDoubanMetadata(subject)).toMatchObject({
      intro: '简介',
      duration: '142分钟',
      directors: ['导演'],
      actors: [{ name: '演员', photo: '' }],
      rating: { value: 9.7 },
    })
    expect(parseDoubanMetadata({ message: 'blocked' })).toBeNull()
  })
  it('合并并发并缓存；竖图不作为轮播背景', async () => {
    const getJson = vi.fn(async (url: string) =>
      url.includes('/photos')
        ? {
            photos: [
              {
                image: {
                  large: {
                    url: 'https://img1.doubanio.com/portrait.jpg',
                    width: 600,
                    height: 900,
                  },
                },
              },
              {
                image: {
                  large: {
                    url: 'https://img1.doubanio.com/scene.jpg',
                    width: 1600,
                    height: 900,
                  },
                },
              },
            ],
          }
        : subject
    )
    const service = createDoubanMetadata({ net: { getJson }, frodo: false })
    const [a, b] = await Promise.all([
      service.get('1292052', 'movie'),
      service.get('1292052', 'movie'),
    ])
    expect(a).toEqual(b)
    expect(a?.backdrop).toBe('https://img1.doubanio.com/scene.jpg')
    await service.get('1292052', 'movie')
    expect(getJson).toHaveBeenCalledTimes(2)
  })
  it('剧照失败仍返回详情；详情失败返回 null', async () => {
    const service = createDoubanMetadata({
      net: {
        getJson: vi.fn(async (url: string) => {
          if (url.includes('/photos')) throw new Error('offline')
          return subject
        }),
      },
      frodo: false,
    })
    expect(await service.get('1292052', 'movie')).toMatchObject({
      intro: '简介',
      images: [],
      backdrop: '',
    })
    const failed = createDoubanMetadata({
      net: { getJson: vi.fn().mockRejectedValue(new Error('offline')) },
      frodo: false,
    })
    expect(await failed.get('1292052', 'movie')).toBeNull()
  })
  it('拒绝非数字 ID 与非电影剧集类型', () => {
    expect(() => online.calls.doubanMetadata.parse(['../1', 'movie'])).toThrow()
    expect(() => online.calls.doubanMetadata.parse(['1', 'person'])).toThrow()
  })
})
