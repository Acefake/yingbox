/**
 * 电影整理的纯规则（ADR-0029）：广告不整理、分段与多版本分开、分类文件夹当基准。
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  movieBase,
  movieSuffixes,
  versionLabel,
  withoutAds,
} from '../../src/main/library/writer/organize/organize-movie'

const MB = 1024 ** 2
const root = join('E:', 'root')
const at = (...parts: string[]): string => join(root, ...parts)

describe('withoutAds', () => {
  it('远小于主视频的小视频是广告；体积相近的版本都留下', () => {
    const main = {
      path: at('高跟', 'IPX-928-U', 'IPX-928-U.mp4'),
      size: 5000 * MB,
    }
    const ad = {
      path: at('高跟', 'IPX-928-U', 'x u u 6 2 . c o m.mp4'),
      size: 30 * MB,
    }
    const other = {
      path: at('高跟', 'IPX-928-U', 'IPX-928-C.mp4'),
      size: 4000 * MB,
    }
    expect(withoutAds([main, ad, other])).toEqual([main, other])
    // 带分段号的小尾段是正片的一部分，不当广告
    const cd1 = { path: at('M', 'Movie.CD1.mkv'), size: 700 * MB * 30 }
    const cd2 = { path: at('M', 'Movie.CD2.mkv'), size: 20 * MB }
    expect(withoutAds([cd1, cd2])).toEqual([cd1, cd2])
    // 只有一个视频：不管多小都留
    expect(withoutAds([ad])).toEqual([ad])
  })
})

describe('movieSuffixes', () => {
  it('都带分段号：按分段号排 part', () => {
    expect(
      movieSuffixes([at('M', 'Movie.CD2.mkv'), at('M', 'Movie.CD1.mkv')])
    ).toEqual([' - part2', ' - part1'])
  })

  it('没有分段号：是多版本，按画质与来源区分，不当分段（《绿皮书》两个版本）', () => {
    const remux = at(
      '电影',
      '绿皮书 (2018)',
      '绿皮书 (2018) [tmdbid=490132]-BluRay REMUX-2160p-FGT.mkv'
    )
    const web = at('电影', '绿皮书.Green.Book.2018.1080p.WEB-DL.mkv')
    expect(movieSuffixes([remux, web])).toEqual([
      ' - 2160p REMUX',
      ' - 1080p WEB-DL',
    ])
  })

  it('标签重复或读不出：用版本序号', () => {
    expect(
      movieSuffixes([
        at('M', '歡迎來龍餐館 (2026).mkv'),
        at('M', '歡迎來龍餐館 (2026).mp4'),
      ])
    ).toEqual([' - 版本1', ' - 版本2'])
    expect(movieSuffixes([at('M', 'Movie.mkv')])).toEqual([''])
  })

  it('版本标签：分辨率 + 来源', () => {
    expect(versionLabel('/m/Hope.2026.2160p.BluRay.REMUX.mkv')).toBe(
      '2160p REMUX'
    )
    expect(versionLabel('/m/Hope-4K-Ba.mp4')).toBe('2160p')
    expect(versionLabel('/m/Hope.mp4')).toBe('')
  })
})

describe('movieBase', () => {
  const titles = ['Buddy', '逃出布迪秀']

  it('散放在分类文件夹里：新文件夹建在分类文件夹里', () => {
    expect(movieBase(root, at('电影', 'Buddy.2026.mkv'), titles)).toBe(
      at('电影')
    )
    expect(
      movieBase(root, at('IPZZ', 'www.98T.la@IPZZ-034_4K60FPS.mp4'), [
        'IPZZ-034',
      ])
    ).toBe(at('IPZZ'))
  })

  it('在电影自己的文件夹里：建在它的上层，保留分类目录（「高跟」不丢）', () => {
    expect(
      movieBase(root, at('高跟', 'IPX-928-U', 'IPX-928-U.mp4'), ['IPX-928-U'])
    ).toBe(at('高跟'))
    expect(movieBase(root, at('电影', '逃出布迪秀', 'Buddy.mkv'), titles)).toBe(
      at('电影')
    )
    expect(movieBase(root, at('Buddy (2026)', 'Buddy.mkv'), titles)).toBe(root)
  })

  it('直接放在根目录：基准是根目录', () => {
    expect(movieBase(root, at('Buddy.mkv'), titles)).toBe(root)
  })
})
