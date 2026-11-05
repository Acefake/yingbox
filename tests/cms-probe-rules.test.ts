/**
 * CMS 测活判定：列表要有影片且有可播放地址；连续不通天数。
 */
import { describe, expect, it } from 'vitest'

import {
  DAY_MS,
  assertVideoList,
  deadDays,
  videoListError,
} from '../src/renderer/src/features/online/utils/cms-probe-rules'

const playable = {
  vod_play_url:
    '第1集$https://cdn.example/1.m3u8#第2集$https://cdn.example/2.m3u8',
}

describe('videoListError', () => {
  it('有影片且有 http(s) 播放地址：通过', () => {
    expect(videoListError({ list: [playable] })).toBeNull()
  })

  it('抽查前几条，只要有一条能播就通过', () => {
    expect(
      videoListError({ list: [{ vod_play_url: '' }, {}, playable] })
    ).toBeNull()
  })

  it('没有列表、空列表、全无播放地址：各自给出原因', () => {
    expect(videoListError(undefined)).toBe('接口响应缺少列表')
    expect(videoListError({ list: '错误页' })).toBe('接口响应缺少列表')
    expect(videoListError({ list: [] })).toBe('接口没有任何影片')
    expect(
      videoListError({ list: [{ vod_play_url: '' }, { vod_name: 'x' }] })
    ).toBe('接口没有可播放地址')
  })

  it('只抽查前 5 条：第 6 条才有地址也算不可播', () => {
    const list = [...Array.from({ length: 5 }, () => ({})), playable]
    expect(videoListError({ list })).toBe('接口没有可播放地址')
  })
})

describe('assertVideoList', () => {
  it('有问题就抛出原因', () => {
    expect(() => assertVideoList({ list: [] })).toThrow('接口没有任何影片')
    expect(() => assertVideoList({ list: [playable] })).not.toThrow()
  })
})

describe('deadDays', () => {
  const now = 10 * DAY_MS
  it('没记录或不到一天为 0，按整天向下取整', () => {
    expect(deadDays(undefined, now)).toBe(0)
    expect(deadDays(now - DAY_MS / 2, now)).toBe(0)
    expect(deadDays(now - 3 * DAY_MS - 1000, now)).toBe(3)
  })
})
