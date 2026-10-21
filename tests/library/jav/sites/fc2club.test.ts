/**
 * FC2CLUB：fixture 是 Wayback Machine 存档的 fc2club.net 旧页面（2021-04，现站只回脚本跳转页，抓不到详情）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../../../../src/main/library/providers/jav/number'
import {
  fc2club,
  isFc2clubRedirect,
  parseFc2clubDetail,
} from '../../../../src/main/library/providers/jav/sites/fc2club'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

/** 现站回的脚本跳转页（令牌已截短）。 */
const REDIRECT =
  "<html><head><title>Loading...</title></head><body><script type='text/javascript'>window.location.replace('https://fc2club.top/html/FC2-3662771.html?ch=1&js=x&sid=y');</script></body></html>"

describe('FC2CLUB', () => {
  it('详情页：标题去番号前缀，卖家、封面、剧照；空演员链接不算', () => {
    const url = 'https://fc2club.net/html/FC2-1476434.html'
    const r = parseFc2clubDetail(
      fixture('fc2club-FC2-1476434.html'),
      url,
      '1476434'
    )!
    expect(r).toMatchObject({
      site: 'fc2club',
      code: 'FC2-PPV-1476434',
      title:
        '【清純派Ｇカップ】ペット願望強すぎる現役ドッグトレーナー 20歳 四つん這いで交尾SEX。',
      studio: 'スタミナ二郎',
      actors: [],
      tags: [],
      cover: 'https://fc2club.net/uploadfile/2020/0826/20200826031342206.jpg',
    })
    expect(r.stills).toHaveLength(4)
  })

  it('新版写法：演员卡片、/tag/ 链接、日期行', () => {
    const html = `<div class="show-top-grids"><h3>FC2-123456 テスト</h3>
      <p>日期：2023-01-02</p><a href="/tag/1">素人</a>
      <ul class="slides"><li><h5 class="title">花子</h5></li></ul></div>`
    const r = parseFc2clubDetail(
      html,
      'https://fc2club.top/html/FC2-123456.html',
      '123456'
    )!
    expect(r).toMatchObject({
      title: 'テスト',
      releaseDate: '2023-01-02',
      tags: ['素人'],
      actors: [{ name: '花子' }],
    })
  })

  it('脚本跳转页按站点不可用抛错，不当成查无此片', async () => {
    expect(isFc2clubRedirect(REDIRECT)).toBe(true)
    expect(isFc2clubRedirect(fixture('fc2club-FC2-1476434.html'))).toBe(false)
    await expect(
      fc2club.fetch(parseJavCode('FC2-PPV-3662771.mp4')!, {
        page: async () => REDIRECT,
      })
    ).rejects.toThrow(/跳转/)
  })

  it('只查 FC2；404 为查无此片', async () => {
    expect(fc2club.supports('fc2')).toBe(true)
    expect(fc2club.supports('censored')).toBe(false)
    const seen: string[] = []
    const r = await fc2club.fetch(parseJavCode('FC2-PPV-3662771.mp4')!, {
      page: async url => {
        seen.push(url)
        return null
      },
    })
    expect(r).toBeNull()
    expect(seen).toEqual(['https://fc2club.top/html/FC2-3662771.html'])
  })
})
