import { describe, expect, it } from 'vitest'
import { TMDB_LOGO_BASE, pickLogo } from '../src/shared/tmdb/logo'

interface Logo {
  file_path: string
  iso_639_1: string | null
  vote_average: number
  width: number
}

const logo = (
  file_path: string,
  iso_639_1: string | null,
  vote_average = 0,
  width = 500
): Logo => ({ file_path, iso_639_1, vote_average, width })

describe('pickLogo', () => {
  it('中文优先，其次英文，再其次无文字的', () => {
    expect(
      pickLogo({
        logos: [logo('/en.png', 'en', 9), logo('/zh.png', 'zh', 1)],
      })
    ).toBe(`${TMDB_LOGO_BASE}/zh.png`)
    expect(
      pickLogo({
        logos: [logo('/none.png', null, 9), logo('/en.png', 'en', 1)],
      })
    ).toBe(`${TMDB_LOGO_BASE}/en.png`)
    expect(pickLogo({ logos: [logo('/none.png', null)] })).toBe(
      `${TMDB_LOGO_BASE}/none.png`
    )
  })

  it('同一语言按评分、再按宽度', () => {
    expect(
      pickLogo({
        logos: [
          logo('/a.png', 'zh', 5.1, 800),
          logo('/b.png', 'zh', 5.5, 300),
          logo('/c.png', 'zh', 5.5, 900),
        ],
      })
    ).toBe(`${TMDB_LOGO_BASE}/c.png`)
  })

  it('SVG 和别的语言不要', () => {
    expect(pickLogo({ logos: [logo('/a.svg', 'zh', 9)] })).toBeNull()
    expect(pickLogo({ logos: [logo('/ja.png', 'ja', 9)] })).toBeNull()
    expect(
      pickLogo({ logos: [logo('/a.SVG', 'zh', 9), logo('/en.png', 'en', 1)] })
    ).toBe(`${TMDB_LOGO_BASE}/en.png`)
  })

  it('没有标志图、结果不像样都是 null', () => {
    expect(pickLogo({ logos: [] })).toBeNull()
    expect(pickLogo({})).toBeNull()
    expect(pickLogo(null)).toBeNull()
    expect(pickLogo({ logos: [{ iso_639_1: 'zh' }, 'x', null] })).toBeNull()
  })
})
