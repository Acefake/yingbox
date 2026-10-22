/** 详情页头图地址（api/images.ts heroImage）：铺满整宽，一律取原图，不用缩略图。 */
import { describe, expect, it } from 'vitest'
import { heroImage } from '../../../src/renderer/src/features/library/api/images'

const KEY = '0123456789abcdef0123456789abcdef'

describe('heroImage', () => {
  it('已缓存取本地原图（不带 ?w=）', () => {
    expect(heroImage(`yingbox-media://image/${KEY}`)).toBe(
      `yingbox-media://image/${KEY}`
    )
  })

  it('TMDB 远程换成 original', () => {
    expect(heroImage('https://image.tmdb.org/t/p/w1280/abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/original/abc.jpg'
    )
  })

  it('其他远程原样，空值返回 null', () => {
    expect(heroImage('https://site/pl.jpg')).toBe('https://site/pl.jpg')
    expect(heroImage(null)).toBeNull()
  })
})
