import { describe, expect, it } from 'vitest'
import {
  cleanSiteName,
  mergeSites,
  mirrorUrls,
  parseSubscription,
  planSubscriptionSelection,
  siteKey,
} from '../src/renderer/src/features/online/utils/subscription'

describe('parseSubscription', () => {
  it('解析 LunaTV 的 api_site 对象并清洗名称', () => {
    const sites = parseSubscription({
      cache_time: 7200,
      api_site: {
        a: { name: '🎬-爱奇艺-', api: 'https://a.com/api.php/provide/vod' },
        b: {
          name: '成人',
          api: 'https://b.com/api.php/provide/vod',
          is_adult: true,
        },
        c: { name: '坏的', api: 'https://c.com/not-cms' },
      },
    })
    expect(sites.ordinary).toEqual([
      { name: '爱奇艺', api: 'https://a.com/api.php/provide/vod' },
    ])
    expect(sites.adult).toEqual([
      { name: '成人', api: 'https://b.com/api.php/provide/vod' },
    ])
  })

  it('解析 sites 数组并按地址去重', () => {
    const api = 'https://d.com/api.php/provide/vod'
    expect(
      parseSubscription({
        sites: [
          { name: 'D', api },
          { name: 'D2', api },
        ],
      })
    ).toEqual({ ordinary: [{ name: 'D', api }], adult: [] })
  })

  it('名称为空时用域名', () => {
    expect(
      parseSubscription({
        sites: [{ api: 'https://e.com/api.php/provide/vod' }],
      })
    ).toEqual({
      ordinary: [{ name: 'e.com', api: 'https://e.com/api.php/provide/vod' }],
      adult: [],
    })
  })

  it('不认识的格式返回空', () => {
    const empty = { ordinary: [], adult: [] }
    expect(parseSubscription(null)).toEqual(empty)
    expect(parseSubscription([1, 2])).toEqual(empty)
  })

  it('名称带 🔞 也算成人站', () => {
    const { ordinary, adult } = parseSubscription({
      sites: [{ name: '🔞某站', api: 'https://f.com/api.php/provide/vod' }],
    })
    expect(ordinary).toEqual([])
    expect(adult).toHaveLength(1)
  })
})

describe('siteKey / mergeSites', () => {
  it('忽略大小写、www. 与末尾斜杠', () => {
    expect(siteKey('https://WWW.A.com/api.php/provide/vod/')).toBe(
      siteKey('https://a.com/api.php/provide/vod')
    )
  })
  it('按键去重，靠前的分组优先', () => {
    const first = { name: '自定义', api: 'https://a.com/api.php/provide/vod/' }
    const later = { name: '订阅', api: 'https://www.a.com/api.php/provide/vod' }
    const other = { name: 'B', api: 'https://b.com/api.php/provide/vod' }
    expect(mergeSites([first], [later, other])).toEqual([first, other])
  })
})

describe('cleanSiteName', () => {
  it('去掉表情与首尾装饰', () => {
    expect(cleanSiteName('🎬豆瓣资源')).toBe('豆瓣资源')
    expect(cleanSiteName(' - 卧龙 - ')).toBe('卧龙')
  })
})

describe('mirrorUrls', () => {
  it('GitHub raw 地址补 jsDelivr 与代理', () => {
    expect(
      mirrorUrls('https://raw.githubusercontent.com/o/r/main/x/c.json')
    ).toEqual([
      'https://raw.githubusercontent.com/o/r/main/x/c.json',
      'https://cdn.jsdelivr.net/gh/o/r@main/x/c.json',
      'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/o/r/main/x/c.json',
    ])
  })

  it('其它地址原样返回', () => {
    expect(mirrorUrls('https://x.com/c.json')).toEqual(['https://x.com/c.json'])
  })
})

describe('planSubscriptionSelection', () => {
  it('新源启用，消失的源停用，手动停用的保留', () => {
    expect(
      planSubscriptionSelection({
        previous: ['a', 'b', 'c'],
        next: ['a', 'c', 'd'],
        selected: ['a', 'b'],
      })
    ).toEqual({ enable: ['d'], disable: ['b'] })
  })
})
