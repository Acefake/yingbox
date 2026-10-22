import { describe, expect, it, vi } from 'vitest'

// player-window imports electron at module scope; stub it so the pure
// payload normalizer can be tested in the node environment.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { handle: () => {} },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import {
  TITLE_BAR_HEIGHT,
  framelessOptions,
  normalizePayload,
} from '../src/main/player-window'

describe('framelessOptions', () => {
  it('Windows / Linux 隐藏标题栏，系统按钮用透明底 titleBarOverlay', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const options = framelessOptions(platform)
      expect(options.titleBarStyle).toBe('hidden')
      expect(options.titleBarOverlay).toEqual({
        color: '#00000000',
        symbolColor: '#ffffff',
        height: TITLE_BAR_HEIGHT,
      })
      expect(options.frame).toBeUndefined()
    }
  })

  it('macOS 保留红绿灯，竖直居中在顶栏里', () => {
    const options = framelessOptions('darwin')
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.trafficLightPosition?.y).toBe((TITLE_BAR_HEIGHT - 16) / 2)
  })
})

describe('normalizePayload', () => {
  it('returns null without any playable source', () => {
    expect(normalizePayload(null)).toBeNull()
    expect(normalizePayload({})).toBeNull()
    expect(normalizePayload({ title: 'x' })).toBeNull()
  })

  it('keeps a single source and trims strings', () => {
    expect(
      normalizePayload({ url: '  https://a/b.m3u8  ', title: '  t  ' })
    ).toEqual({
      url: 'https://a/b.m3u8',
      title: '  t  ',
    })
    expect(normalizePayload({ filePath: ' C:/v/a.mp4 ' })).toEqual({
      filePath: 'C:/v/a.mp4',
    })
  })

  it('preserves same-episode fallback lines', () => {
    const normalized = normalizePayload({
      url: 'https://a/1.m3u8',
      fallbacks: [
        {
          url: 'https://b/1.m3u8',
          name: '乙站 · 线路1',
          siteName: 'b',
          ext: { id: 7 },
        },
        { filePath: 'C:/v/1.mp4', name: '本地' },
      ],
    })
    expect(normalized?.fallbacks).toEqual([
      {
        url: 'https://b/1.m3u8',
        name: '乙站 · 线路1',
        siteName: 'b',
        ext: { id: 7 },
      },
      { filePath: 'C:/v/1.mp4', name: '本地' },
    ])
  })

  it('drops malformed fallback entries instead of failing', () => {
    const normalized = normalizePayload({
      url: 'https://a/1.m3u8',
      fallbacks: [
        null,
        'nope',
        {},
        { name: 'no source' },
        { url: 'https://c/1.m3u8' },
      ],
    })
    expect(normalized?.fallbacks).toEqual([{ url: 'https://c/1.m3u8' }])
  })

  it('omits fallbacks when the list is empty', () => {
    const normalized = normalizePayload({
      url: 'https://a/1.m3u8',
      fallbacks: [],
    })
    expect(normalized).not.toHaveProperty('fallbacks')
  })

  it('resolves the start item from a playlist and clamps an out-of-range index', () => {
    const normalized = normalizePayload({
      playlist: [{ filePath: 'C:/v/1.mp4' }, { url: 'https://a/2.m3u8' }],
      index: 9,
    })
    expect(normalized).toEqual({
      url: 'https://a/2.m3u8',
      playlist: [{ filePath: 'C:/v/1.mp4' }, { url: 'https://a/2.m3u8' }],
      index: 1,
    })
  })

  it('caps oversized playlists and fallback lists', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      url: `https://a/${i}.m3u8`,
    }))
    const normalized = normalizePayload({
      url: 'https://a/x.m3u8',
      playlist: many,
      fallbacks: many,
    })
    expect(normalized?.playlist).toHaveLength(500)
    expect(normalized?.fallbacks).toHaveLength(500)
  })
})
