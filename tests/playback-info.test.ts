import { describe, expect, it } from 'vitest'

import {
  type InfoSample,
  bufferAhead,
  codecText,
  containerOf,
  droppedText,
  estimateBitrate,
  formatBitrate,
  hlsLevelText,
  infoRows,
  mpvInfoRows,
  sourceKind,
} from '../src/renderer/src/features/player/playback-info/info-rules'

const base: InfoSample = {
  url: 'local://media/C%3A/movies/a.mkv',
  width: 1920,
  height: 1080,
  currentTime: 10,
  buffered: [[0, 25]],
  quality: { dropped: 3, total: 1000 },
}

describe('播放信息面板规则', () => {
  it('地址类型', () => {
    expect(sourceKind('local://media/a.mp4')).toBe('本地文件')
    expect(sourceKind('https://x.com/a/index.m3u8?t=1')).toBe('HLS（m3u8）')
    expect(sourceKind('https://x.com/a.flv')).toBe('FLV 直链')
    expect(sourceKind('https://x.com/a.mp4')).toBe('HTTP 直链')
    expect(sourceKind('/media/files/12?token=a')).toBe('媒体库服务器')
    expect(sourceKind('blob:abc')).toBe('Blob（内存）')
    expect(sourceKind('xyz')).toBe('其他')
    expect(sourceKind('D:\\movies\\a.mkv')).toBe('本地文件')
    expect(sourceKind('\\\\nas\\share\\a.mkv')).toBe('本地文件')
    expect(sourceKind('/Users/me/a.mkv')).toBe('本地文件')
  })

  it('容器格式取自扩展名', () => {
    expect(containerOf('https://x.com/a.mp4?x=1')).toBe('MP4')
    expect(containerOf('local://media/C%3A/b.mkv')).toBe('MKV')
    expect(containerOf('https://x.com/play')).toBe('')
  })

  it('码率文案与估算', () => {
    expect(formatBitrate(4_200_000)).toBe('4.20 Mbps')
    expect(formatBitrate(850_000)).toBe('850 kbps')
    expect(formatBitrate(undefined)).toBe('—')
    expect(formatBitrate(0)).toBe('—')
    expect(estimateBitrate(0, 500_000, 1000)).toBe(4_000_000)
    expect(estimateBitrate(500, 100, 1000)).toBeUndefined()
    expect(estimateBitrate(0, 100, 0)).toBeUndefined()
  })

  it('当前位置往后的缓冲秒数', () => {
    expect(bufferAhead([[0, 25]], 10)).toBe(15)
    expect(
      bufferAhead(
        [
          [0, 5],
          [8, 30],
        ],
        10
      )
    ).toBe(20)
    expect(bufferAhead([[0, 5]], 10)).toBe(0)
  })

  it('HLS 档位文案', () => {
    const hls = {
      levels: [
        { height: 720, bitrate: 2_000_000 },
        { height: 1080, bitrate: 4_200_000 },
      ],
      current: 1,
      auto: true,
    }
    expect(hlsLevelText(hls)).toBe('1080p · 4.20 Mbps（自动，2/2）')
    expect(hlsLevelText({ ...hls, auto: false, current: 0 })).toBe(
      '720p · 2.00 Mbps（1/2）'
    )
    expect(hlsLevelText({ ...hls, current: -1 })).toBe('共 2 档')
    expect(hlsLevelText({ levels: [], current: -1, auto: true })).toBe('—')
  })

  it('编码：HLS 用档位声明，其余给容器', () => {
    expect(codecText(base)).toBe('未知（容器 MKV）')
    expect(
      codecText({
        ...base,
        hls: {
          levels: [{ videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2' }],
          current: 0,
          auto: true,
        },
      })
    ).toBe('avc1.640028 / mp4a.40.2')
  })

  it('丢帧文案', () => {
    expect(droppedText({ dropped: 3, total: 1000 })).toBe('3 / 1000（0.30%）')
    expect(droppedText({ dropped: 0, total: 0 })).toBe('0 / 0')
    expect(droppedText(undefined)).toBe('—')
  })

  it('内置播放器的面板行：非 HLS 没有档位行，码率估算优先于档位标称', () => {
    const rows = infoRows({ ...base, bitrate: 8_000_000 })
    expect(rows.map(r => r.label)).toEqual([
      '地址类型',
      '编码',
      '分辨率',
      '码率',
      '缓冲',
      '丢帧',
    ])
    expect(rows.find(r => r.label === '分辨率')?.value).toBe('1920×1080')
    expect(rows.find(r => r.label === '码率')?.value).toBe('≈ 8.00 Mbps')
    expect(rows.find(r => r.label === '缓冲')?.value).toBe('15.0 秒')

    const hlsRows = infoRows({
      ...base,
      url: 'https://x.com/index.m3u8',
      hls: {
        levels: [{ height: 1080, bitrate: 4_200_000 }],
        current: 0,
        auto: true,
        bandwidth: 20_000_000,
      },
    })
    expect(hlsRows.find(r => r.label === '码率')?.value).toBe(
      '4.20 Mbps（档位标称）'
    )
    expect(hlsRows.find(r => r.label === 'HLS 档位')?.value).toBe(
      '1080p · 4.20 Mbps（自动，1/1）'
    )
    expect(hlsRows.find(r => r.label === '网速估计')?.value).toBe('20.00 Mbps')
  })

  it('mpv 的面板行：复用 MpvStatus，没在运行时为空', () => {
    const status = {
      running: true,
      paused: false,
      volume: 100,
      muted: false,
      speed: 1,
      playlist: [],
      playlistPos: 0,
      path: 'D:/movies/a.mkv',
      videoWidth: 1280,
      videoHeight: 720,
      vsr: true,
      vsrWidth: 2560,
      vsrHeight: 1440,
      tracks: [
        { id: 1, type: 'video' as const, selected: true, codec: 'hevc' },
        { id: 1, type: 'audio' as const, selected: true, codec: 'aac' },
        { id: 2, type: 'audio' as const, selected: false, codec: 'ac3' },
      ],
    }
    expect(mpvInfoRows(status)).toEqual([
      { label: '编码', value: 'hevc / aac' },
      { label: '分辨率', value: '1280×720' },
      { label: '超分', value: 'RTX VSR → 2560×1440' },
      { label: '地址类型', value: '本地文件' },
    ])
    expect(mpvInfoRows({ ...status, running: false })).toEqual([])
  })
})
