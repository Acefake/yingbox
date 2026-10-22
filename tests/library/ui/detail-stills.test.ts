/** 详情页剧照的来源规则（detail-rules.ts stillsOf）与地址（api/images.ts stillImage）。 */
import { describe, expect, it } from 'vitest'
import { stillsOf } from '../../../src/renderer/src/features/library/detail/detail-rules'
import { stillImage } from '../../../src/renderer/src/features/library/api/images'

type Meta = Parameters<typeof stillsOf>[0]
const meta = (images: Array<{ role: string; path: string }>): Meta =>
  ({ images }) as unknown as Meta

describe('stillsOf', () => {
  it('有剧照只取剧照，去重', () => {
    expect(
      stillsOf(
        meta([
          { role: 'backdrop', path: 'https://x/pl.jpg' },
          { role: 'still', path: 'https://x/jp-1.jpg' },
          { role: 'still', path: 'https://x/jp-2.jpg' },
          { role: 'still', path: 'https://x/jp-1.jpg' },
        ])
      )
    ).toEqual(['https://x/jp-1.jpg', 'https://x/jp-2.jpg'])
  })

  it('没有剧照：退回除头图外的背景图；没有元数据为空', () => {
    expect(
      stillsOf(
        meta([
          { role: 'backdrop', path: '/a.jpg' },
          { role: 'backdrop', path: '/b.jpg' },
          { role: 'poster', path: '/p.jpg' },
        ])
      )
    ).toEqual(['/b.jpg'])
    expect(stillsOf(null)).toEqual([])
  })

  it('最多 30 张', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      role: 'still',
      path: `https://x/${i}.jpg`,
    }))
    expect(stillsOf(meta(many))).toHaveLength(30)
  })
})

describe('stillImage', () => {
  it('番号站点绝对地址桌面端原样；TMDB 相对路径按尺寸拼', () => {
    expect(stillImage('https://pics.dmm.co.jp/a/jp-1.jpg', 'thumb')).toBe(
      'https://pics.dmm.co.jp/a/jp-1.jpg'
    )
    expect(stillImage('/abc.jpg', 'thumb')).toBe(
      'https://image.tmdb.org/t/p/w500/abc.jpg'
    )
    expect(stillImage('/abc.jpg', 'full')).toBe(
      'https://image.tmdb.org/t/p/original/abc.jpg'
    )
  })
})
