import { describe, expect, it } from 'vitest'
import { asArray, asRecord, asText } from '../src/renderer/src/utils/json'
import {
  asRawVod,
  firstPlayUrl,
  getVodList,
  pluginTabs,
} from '../src/renderer/src/utils/vod-data'

describe('外部数据收窄（utils/json）', () => {
  it('asRecord：只认普通对象，数组 / null / 基本类型都是 undefined', () => {
    const obj = { a: 1 }
    expect(asRecord(obj)).toBe(obj)
    expect(asRecord([1])).toBeUndefined()
    expect(asRecord(null)).toBeUndefined()
    expect(asRecord('x')).toBeUndefined()
    expect(asRecord(undefined)).toBeUndefined()
  })

  it('asArray：数组原样返回，其余给空数组', () => {
    const list = [1, 2]
    expect(asArray(list)).toBe(list)
    expect(asArray({ length: 1 })).toEqual([])
    expect(asArray('ab')).toEqual([])
    expect(asArray(undefined)).toEqual([])
  })

  it('asText：字符串原样，有限数字转字符串，其余空串', () => {
    expect(asText('片名')).toBe('片名')
    expect(asText(0)).toBe('0')
    expect(asText(12.5)).toBe('12.5')
    expect(asText(Number.NaN)).toBe('')
    expect(asText(Number.POSITIVE_INFINITY)).toBe('')
    expect(asText(true)).toBe('')
    expect(asText({ toString: () => 'x' })).toBe('')
    expect(asText(null)).toBe('')
  })
})

describe('插件 / CMS 原始数据（utils/vod-data）', () => {
  it('asRawVod：对象原样当条目读，不是对象时给空条目', () => {
    const raw = { vod_name: 'A', extra: 1 }
    expect(asRawVod(raw)).toBe(raw)
    expect(asRawVod('A')).toEqual({})
    expect(asRawVod([{ vod_name: 'A' }])).toEqual({})
  })

  it('getVodList：顶层 list 优先，其次 data.list（data 可以是 JSON 字符串）', () => {
    expect(getVodList(JSON.stringify({ list: [1] }))).toEqual([1])
    expect(getVodList({ data: { list: [2] } })).toEqual([2])
    expect(getVodList({ list: 'x', data: { list: [3] } })).toEqual([3])
    expect(getVodList(null)).toEqual([])
  })

  it('firstPlayUrl：urls 或 data.urls 的第一个，数字转字符串，没有给空串', () => {
    expect(firstPlayUrl({ urls: ['a'] })).toBe('a')
    expect(firstPlayUrl({ urls: [], data: { urls: ['b'] } })).toBe('')
    expect(firstPlayUrl({ data: { urls: [7] } })).toBe('7')
    expect(firstPlayUrl({ urls: [{ url: 'x' }] })).toBe('')
    expect(firstPlayUrl('x')).toBe('')
  })

  it('pluginTabs：名称不是字符串时给空串，ext 不是对象时给空对象', () => {
    expect(
      pluginTabs({
        tabs: [
          { name: 1, ext: 'x' },
          'bad',
          { name: { zh: '剧' } },
          { name: '电影' },
        ],
      })
    ).toEqual([
      { name: '1', ext: {} },
      { name: '', ext: {} },
      { name: '', ext: {} },
      { name: '电影', ext: {} },
    ])
  })
})
