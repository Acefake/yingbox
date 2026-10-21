import { describe, expect, it } from 'vitest'
import {
  cleanSiteName,
  mirrorUrls,
  parseSubscription,
  planSubscriptionSelection,
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
    expect(sites).toEqual([
      { name: '爱奇艺', api: 'https://a.com/api.php/provide/vod' },
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
    ).toEqual([{ name: 'D', api }])
  })

  it('名称为空时用域名', () => {
    expect(
      parseSubscription({
        sites: [{ api: 'https://e.com/api.php/provide/vod' }],
      })
    ).toEqual([{ name: 'e.com', api: 'https://e.com/api.php/provide/vod' }])
  })

  it('不认识的格式返回空', () => {
    expect(parseSubscription(null)).toEqual([])
    expect(parseSubscription([1, 2])).toEqual([])
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
