import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { needsMpv } from '../src/shared/disc-media'
import { discKindOf, discSourceOf } from '../src/main/mpv-disc'
import { spawnArgs } from '../src/main/mpv-props'
import { mpvStream } from '../src/main/mpv-stream'
import { fileKindOf } from '../src/main/library/scanner/rules'
import { playbackRoute } from '../src/renderer/src/features/player/utils/playback-route'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function isoWith(content: Buffer, name = 'disc.iso'): string {
  const dir = mkdtempSync(join(tmpdir(), 'yingbox-iso-'))
  dirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, Buffer.concat([Buffer.alloc(4096), content]))
  return file
}

describe('光盘镜像与原盘文件', () => {
  it('扫描收录 iso / m2ts / mts / vob / mpg / mpeg / 3gp，大小写不敏感由调用方转小写', () => {
    for (const name of [
      'a.iso',
      'a.m2ts',
      'a.mts',
      'a.vob',
      'a.mpg',
      'a.mpeg',
      'a.3gp',
    ])
      expect(fileKindOf(name)).toBe('video')
    expect(fileKindOf('a.txt')).toBeUndefined()
  })

  it('只有 mpv 能播的文件：镜像、m2ts、vob 等；普通视频和远程地址的查询串不受影响', () => {
    expect(needsMpv('D:\\电影\\Avatar.ISO')).toBe(true)
    expect(needsMpv('/m/BDMV/STREAM/00001.m2ts')).toBe(true)
    expect(needsMpv('/m/VTS_01_1.VOB')).toBe(true)
    expect(needsMpv('https://nas/files/9.iso?token=a.mkv')).toBe(true)
    expect(needsMpv('/m/a.mkv')).toBe(false)
    expect(needsMpv('https://nas/files/9.mkv?name=a.iso')).toBe(false)
    expect(needsMpv(undefined)).toBe(false)
  })

  it('播放路由：只有 mpv 能播的文件直接走 mpv，即使选的是内置引擎、没开 DV 自动', () => {
    const base = {
      engine: 'built-in',
      autoMpvForDv: false,
      mpvBridge: true,
    } as const
    expect(playbackRoute({ ...base, mpvOnly: true }).tryMpv).toBe(true)
    expect(playbackRoute(base).tryMpv).toBe(false)
    expect(
      playbackRoute({ ...base, mpvOnly: true, mpvBridge: false }).tryMpv
    ).toBe(false)
  })

  it('按镜像开头的目录项分蓝光 / DVD（ASCII 与 UTF-16BE 都认），混合盘按蓝光', () => {
    expect(discKindOf(Buffer.from('xxBDMVxx'))).toBe('bluray')
    expect(discKindOf(Buffer.from('xxVIDEO_TSxx'))).toBe('dvd')
    expect(
      discKindOf(
        Buffer.concat([
          Buffer.from('xx'),
          Buffer.from('BDMV', 'utf16le').swap16(),
        ])
      )
    ).toBe('bluray')
    expect(discKindOf(Buffer.from('BDMV VIDEO_TS'))).toBe('bluray')
    expect(discKindOf(Buffer.from('plain'))).toBeNull()
  })

  it('discSourceOf：蓝光 / DVD 镜像给出 bd:// / dvd:// 与设备选项，其它情况返回 null', async () => {
    const bd = isoWith(Buffer.from('BDMV'))
    const dvd = isoWith(Buffer.from('VIDEO_TS'))
    const unknown = isoWith(Buffer.from('nothing'))
    expect(await discSourceOf(bd)).toEqual({
      target: 'bd://',
      option: 'bluray-device',
      device: bd,
    })
    expect(await discSourceOf(dvd)).toEqual({
      target: 'dvd://',
      option: 'dvd-device',
      device: dvd,
    })
    expect(await discSourceOf(unknown)).toBeNull()
    expect(
      await discSourceOf(join(tmpdir(), 'yingbox-not-exist.iso'))
    ).toBeNull()
    expect(await discSourceOf('/m/a.mkv')).toBeNull()
  })

  it('mpv 参数：镜像用 bd:// 目标并带设备选项，普通文件不变', () => {
    const disc = {
      target: 'bd://',
      option: 'bluray-device',
      device: 'D:\\a.iso',
    } as const
    expect(mpvStream({ filePath: 'D:\\a.iso' }, disc)).toEqual({
      target: 'bd://',
      headers: {},
    })
    expect(mpvStream({ filePath: 'D:\\a.mkv' })).toEqual({
      target: 'D:\\a.mkv',
      headers: {},
    })
    const args = spawnArgs({
      socket: 's',
      target: 'bd://',
      headers: {},
      vsr: false,
      disc,
    })
    expect(args.slice(-2)).toEqual(['--bluray-device=D:\\a.iso', 'bd://'])
  })
})
