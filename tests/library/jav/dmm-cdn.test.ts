/** DMM 图床地址规则（sites/dmm/cdn.ts）与占位图识别。 */
import { describe, expect, it } from 'vitest'
import { isPlaceholderImage } from '../../../src/main/library/images/placeholder'
import {
  highResUrl,
  imageCandidates,
  posterCandidates,
  stripTransform,
} from '../../../src/main/library/providers/jav/sites/dmm/cdn'

const AWS = 'https://awsimgsrc.dmm.co.jp/pics_dig'

describe('DMM 图床', () => {
  it('digital 路径原样换到高清图床；mono 去掉分类目录；其他分类没有高清副本', () => {
    expect(
      highResUrl(
        'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg'
      )
    ).toBe(`${AWS}/digital/video/ssis00497/ssis00497pl.jpg`)
    expect(
      highResUrl(
        'https://pics.dmm.co.jp/mono/movie/adult/ssis497/ssis497pl.jpg'
      )
    ).toBe(`${AWS}/mono/movie/ssis497/ssis497pl.jpg`)
    expect(
      highResUrl('https://pics.dmm.co.jp/digital/e-book/x/xpl.jpg')
    ).toBeUndefined()
    expect(
      highResUrl('https://www.javbus.com/pics/cover/a_b.jpg')
    ).toBeUndefined()
  })

  it('候选：高清在前、标准兜底；缩放查询串去掉；非 DMM 地址原样', () => {
    const pics = 'https://pics.dmm.co.jp/digital/video/a00001/a00001pl.jpg'
    expect(imageCandidates(`${pics}?w=147`)).toEqual([
      `${AWS}/digital/video/a00001/a00001pl.jpg`,
      pics,
    ])
    expect(imageCandidates(`${AWS}/digital/video/a/apl.jpg?w=200`)).toEqual([
      `${AWS}/digital/video/a/apl.jpg`,
    ])
    expect(stripTransform('https://x.com/a.jpg?w=1')).toBe(
      'https://x.com/a.jpg?w=1'
    )
  })

  it('pl 封面推出 ps 海报候选；不是 pl 形态为空', () => {
    expect(
      posterCandidates(
        'https://pics.dmm.co.jp/digital/video/a00001/a00001pl.jpg'
      )
    ).toEqual([
      `${AWS}/digital/video/a00001/a00001ps.jpg`,
      'https://pics.dmm.co.jp/digital/video/a00001/a00001ps.jpg',
    ])
    expect(
      posterCandidates('https://www.javbus.com/pics/cover/a_b.jpg')
    ).toEqual([])
  })

  it('now_printing 重定向目标是占位图', () => {
    expect(
      isPlaceholderImage(
        'https://imgsrc.dmm.com/pics/mono/movie/n/now_printing/now_printing.jpg?w=147'
      )
    ).toBe(true)
    expect(isPlaceholderImage('https://pics.dmm.co.jp/a/apl.jpg')).toBe(false)
    expect(isPlaceholderImage(undefined)).toBe(false)
  })
})
