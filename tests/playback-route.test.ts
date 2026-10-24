import { describe, expect, it } from 'vitest'

import {
  dvNotice,
  playbackRoute,
} from '../src/renderer/src/features/player/utils/playback-route'

const P5 = { range: 'dv', dvProfile: 5, dvCompat: 0 } as const
const P8 = { range: 'dv', dvProfile: 8, dvCompat: 1 } as const
const HDR10 = { range: 'hdr10', dvProfile: null, dvCompat: null } as const

describe('播放路由决策', () => {
  it('内置引擎 + DV P5 + 开着自动 mpv + 有 mpv 桥：改走 mpv，原因是 DV', () => {
    expect(
      playbackRoute({
        engine: 'built-in',
        video: P5,
        autoMpvForDv: true,
        mpvBridge: true,
      })
    ).toEqual({ tryMpv: true, dv: true })
  })

  it('P8 / HDR10 / 没有探测信息时照常内置播放', () => {
    for (const video of [P8, HDR10, null, undefined])
      expect(
        playbackRoute({
          engine: 'built-in',
          video,
          autoMpvForDv: true,
          mpvBridge: true,
        })
      ).toEqual({ tryMpv: false, dv: false })
  })

  it('设置关掉自动 mpv、或没有 mpv 桥（网页端）时内置播放', () => {
    expect(
      playbackRoute({
        engine: 'built-in',
        video: P5,
        autoMpvForDv: false,
        mpvBridge: true,
      })
    ).toEqual({ tryMpv: false, dv: true })
    expect(
      playbackRoute({
        engine: 'built-in',
        video: P5,
        autoMpvForDv: true,
        mpvBridge: false,
      })
    ).toEqual({ tryMpv: false, dv: true })
  })

  it('用户本来就选 mpv：照常走 mpv', () => {
    expect(
      playbackRoute({
        engine: 'mpv',
        video: HDR10,
        autoMpvForDv: false,
        mpvBridge: true,
      })
    ).toEqual({ tryMpv: true, dv: false })
  })
})

describe('DV 提示', () => {
  it('因 DV 自动切到 mpv 并成功：说明原因', () => {
    expect(
      dvNotice({ tryMpv: true, dv: true }, 'ok', { engine: 'built-in', autoMpvForDv: true })
    ).toBe('mpv-used')
  })

  it('mpv 起不来或没有 mpv 桥：内置播放并建议安装 mpv', () => {
    expect(
      dvNotice({ tryMpv: true, dv: true }, 'failed', { engine: 'built-in', autoMpvForDv: true })
    ).toBe('install-mpv')
    expect(
      dvNotice({ tryMpv: false, dv: true }, 'skipped', { engine: 'built-in', autoMpvForDv: true })
    ).toBe('install-mpv')
  })

  it('用户关掉了自动 mpv：不打扰；不是 DV P5：不提示', () => {
    expect(
      dvNotice({ tryMpv: false, dv: true }, 'skipped', { engine: 'built-in', autoMpvForDv: false })
    ).toBeNull()
    expect(
      dvNotice({ tryMpv: true, dv: false }, 'ok', { engine: 'mpv', autoMpvForDv: true })
    ).toBeNull()
    expect(
      dvNotice({ tryMpv: false, dv: false }, 'skipped', { engine: 'built-in', autoMpvForDv: true })
    ).toBeNull()
  })

  it('用户选了 mpv 但起不来、视频是 DV P5：同样建议安装 mpv', () => {
    expect(
      dvNotice({ tryMpv: true, dv: true }, 'failed', { engine: 'mpv', autoMpvForDv: false })
    ).toBe('install-mpv')
  })
})
