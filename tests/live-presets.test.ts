import { describe, expect, it } from 'vitest'

import {
  LIVE_PRESETS,
  type LivePreset,
  isPresetSubscribed,
  networkLabel,
  presetMirrorsFor,
} from '../src/renderer/src/features/live/utils/live-presets'
import {
  type LiveSource,
  isValidSourceUrl,
  sanitizeSource,
} from '../src/renderer/src/features/live/utils/live-rules'

const source = (patch: Partial<LiveSource>): LiveSource => ({
  id: 'src-1',
  name: '某源',
  kind: 'url',
  location: 'https://example.com/a.m3u',
  epgUrl: '',
  enabled: true,
  ...patch,
})

const preset = (patch: Partial<LivePreset> = {}): LivePreset => ({
  id: 'p',
  name: '预置',
  description: '说明',
  url: 'https://example.com/a.m3u',
  network: 'ipv4',
  ...patch,
})

describe('推荐直播源清单', () => {
  it('包含约定的四个源，地址、镜像与节目单逐条一致', () => {
    const byId = Object.fromEntries(LIVE_PRESETS.map(p => [p.id, p]))
    expect(Object.keys(byId)).toEqual([
      'vbskycn',
      'zhi35',
      'fanmingming',
      'iptv-org',
    ])
    expect(byId.vbskycn).toMatchObject({
      url: 'https://live.zbds.org/tv/iptv4.m3u',
      mirrors: [
        'https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u',
        'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
      ],
      network: 'ipv4',
    })
    expect(byId.vbskycn.epgUrl).toBeUndefined()
    expect(byId.zhi35).toMatchObject({
      url: 'https://live.zhi35.com/iptv.m3u',
      epgUrl: 'https://live.zhi35.com/epg.xml.gz',
      network: 'dual',
    })
    expect(byId.fanmingming).toMatchObject({
      url: 'https://live.fanmingming.cn/tv/m3u/ipv6.m3u',
      epgUrl: 'https://live.fanmingming.cn/e.xml',
      network: 'ipv6',
    })
    expect(byId['iptv-org']).toMatchObject({
      url: 'https://iptv-org.github.io/iptv/countries/cn.m3u',
      network: 'ipv4',
    })
  })

  it('不再推荐停更的 Guovin 列表', () => {
    expect(LIVE_PRESETS.some(p => p.url.includes('Guovin'))).toBe(false)
  })

  it('镜像地址合法、不与主地址重复', () => {
    for (const p of LIVE_PRESETS)
      for (const mirror of p.mirrors ?? []) {
        expect(isValidSourceUrl(mirror)).toBe(true)
        expect(mirror).not.toBe(p.url)
      }
  })

  it('每条都有名称与简述，地址合法、无首尾空白', () => {
    for (const p of LIVE_PRESETS) {
      expect(p.name.trim()).not.toBe('')
      expect(p.description.trim()).not.toBe('')
      expect(isValidSourceUrl(p.url)).toBe(true)
      expect(p.url).toBe(p.url.trim())
      if (p.epgUrl !== undefined) {
        expect(isValidSourceUrl(p.epgUrl)).toBe(true)
        expect(p.epgUrl).toBe(p.epgUrl.trim())
      }
    }
  })

  it('id、名称、地址都不重复', () => {
    for (const key of ['id', 'name', 'url'] as const) {
      const values = LIVE_PRESETS.map(p => p[key])
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('清单不可被改写', () => {
    expect(Object.isFrozen(LIVE_PRESETS)).toBe(true)
    for (const p of LIVE_PRESETS) expect(Object.isFrozen(p)).toBe(true)
  })

  it('网络标签', () => {
    expect(networkLabel('dual')).toBe('IPv4 / IPv6')
    expect(networkLabel('ipv4')).toBe('IPv4')
    expect(networkLabel('ipv6')).toBe('仅 IPv6')
  })
})

describe('「已订阅」判定', () => {
  it('没有源时未订阅', () => {
    expect(isPresetSubscribed(preset(), [])).toBe(false)
  })

  it('远程源地址相同即已订阅，与名称、启用状态无关', () => {
    expect(
      isPresetSubscribed(preset(), [
        source({ name: '随便叫什么', enabled: false }),
      ])
    ).toBe(true)
  })

  it('地址不同不算', () => {
    expect(
      isPresetSubscribed(preset(), [
        source({ location: 'https://example.com/b.m3u' }),
      ])
    ).toBe(false)
  })

  it('地址前后空白忽略（与添加时的 trim 一致）', () => {
    expect(
      isPresetSubscribed(preset({ url: ' https://example.com/a.m3u ' }), [
        source({}),
      ])
    ).toBe(true)
  })

  it('同路径的本地文件源不算订阅', () => {
    expect(
      isPresetSubscribed(preset(), [
        source({ kind: 'file', location: 'https://example.com/a.m3u' }),
      ])
    ).toBe(false)
  })

  it('大小写或查询串不同视为不同地址', () => {
    expect(
      isPresetSubscribed(preset(), [
        source({ location: 'https://example.com/A.m3u' }),
        source({ id: 'b', location: 'https://example.com/a.m3u?x=1' }),
      ])
    ).toBe(false)
  })
})

describe('推荐源镜像', () => {
  it('镜像地址订阅的也算已订阅', () => {
    const vbskycn = LIVE_PRESETS.find(p => p.id === 'vbskycn')!
    expect(
      isPresetSubscribed(vbskycn, [source({ location: vbskycn.mirrors![0] })])
    ).toBe(true)
  })

  it('早先订阅的推荐源按清单补出其余地址作备用；普通地址没有备用', () => {
    expect(presetMirrorsFor('https://live.zbds.org/tv/iptv4.m3u')).toEqual([
      'https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u',
      'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
    ])
    expect(
      presetMirrorsFor(
        'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u'
      )
    ).toEqual([
      'https://live.zbds.org/tv/iptv4.m3u',
      'https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u',
    ])
    expect(presetMirrorsFor('https://example.com/a.m3u')).toEqual([])
  })

  it('存储里的镜像只留合法 http(s)，最多 3 个；没有时不带字段', () => {
    const base = { id: 's', kind: 'url', location: 'https://a/x.m3u' }
    expect(
      sanitizeSource({
        ...base,
        mirrors: [
          ' https://b/x.m3u ',
          'ftp://c/x',
          7,
          'https://d',
          'https://e',
          'https://f',
        ],
      })?.mirrors
    ).toEqual(['https://b/x.m3u', 'https://d', 'https://e'])
    expect(sanitizeSource({ ...base, mirrors: ['nope'] })).not.toHaveProperty(
      'mirrors'
    )
    expect(sanitizeSource(base)).not.toHaveProperty('mirrors')
  })
})
