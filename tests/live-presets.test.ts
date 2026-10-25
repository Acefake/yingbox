import { describe, expect, it } from 'vitest'

import {
  LIVE_PRESETS,
  type LivePreset,
  isPresetSubscribed,
  networkLabel,
} from '../src/renderer/src/features/live/utils/live-presets'
import {
  type LiveSource,
  isValidSourceUrl,
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
  it('包含约定的四个源，地址与节目单逐条一致', () => {
    const byId = Object.fromEntries(LIVE_PRESETS.map(p => [p.id, p]))
    expect(Object.keys(byId)).toEqual([
      'zhi35',
      'vbskycn',
      'guovin',
      'fanmingming',
    ])
    expect(byId.zhi35).toMatchObject({
      url: 'https://live.zhi35.com/iptv.m3u',
      epgUrl: 'https://live.zhi35.com/epg.xml.gz',
      network: 'dual',
    })
    expect(byId.vbskycn).toMatchObject({
      url: 'https://live.zbds.org/tv/iptv4.m3u',
      network: 'ipv4',
    })
    expect(byId.vbskycn.epgUrl).toBeUndefined()
    expect(byId.guovin).toMatchObject({
      url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u',
      network: 'ipv4',
    })
    expect(byId.fanmingming).toMatchObject({
      url: 'https://live.fanmingming.cn/tv/m3u/ipv6.m3u',
      epgUrl: 'https://live.fanmingming.cn/e.xml',
      network: 'ipv6',
    })
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
