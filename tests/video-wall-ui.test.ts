// @vitest-environment jsdom
import { type App, createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ItemPreview, LibraryItemSummary } from '../src/shared/library/ipc'

/**
 * 视频墙组件（真组件 + 假片库）：同时播放上限、选格换名额、空格暂停全部、窗口隐藏暂停、
 * 减少动态效果只放静态图、点格打开详情、播放走 openMediaPlayer、Esc / 退出全屏关闭、
 * 卸载时清空所有 video 的 src 并 load()。
 */

const bridge = {
  getPreview: vi.fn(
    async (id: number): Promise<ItemPreview | null> => ({
      video: { fileId: id, path: `/m/${id}.mp4` },
      images: [],
    })
  ),
  getItem: vi.fn(async (id: number) => ({
    ...item(id),
    seasonNumber: null,
    episodeNumber: null,
    files: [{ id, path: `/m/${id}.mp4`, kind: 'video' }],
    children: [],
  })),
}
const openMediaPlayer = vi.fn(async () => true)

vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => bridge,
  usesLibraryServer: () => false,
}))
vi.mock('../src/renderer/src/services/library-server', () => ({
  isWebRuntime: () => false,
  serverFileUrl: (id: number) => `https://nas/media/files/${id}`,
  libraryServerState: () => ({ value: 'unknown' }),
  probeLibraryServerAgain: async () => 'offline',
}))
vi.mock('../src/renderer/src/features/player', () => ({ openMediaPlayer }))

function item(id: number): LibraryItemSummary {
  return {
    id,
    libraryId: 1,
    type: 'movie',
    title: `影片 ${id}`,
    originalTitle: null,
    year: 2020,
    matchState: 'auto',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: null,
    addedAt: 0,
    updatedAt: 0,
  }
}

const calls: string[] = []
let reduced = false
let app: App | null = null
let events: { close: number; open: number[] }
const fullscreen = { requested: 0, exited: 0 }

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await nextTick()
    await Promise.resolve()
  }
}

async function mount(count = 9): Promise<HTMLElement> {
  const { default: VideoWall } =
    await import('../src/renderer/src/features/library/video-wall/VideoWall.vue')
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () =>
      h(VideoWall, {
        items: Array.from({ length: count }, (_, i) => item(i + 1)),
        onClose: () => events.close++,
        onOpen: (id: number) => events.open.push(id),
      }),
  })
  app.mount(root)
  await settle()
  return document.querySelector('.video-wall') as HTMLElement
}

const videos = (): HTMLVideoElement[] => [
  ...document.querySelectorAll<HTMLVideoElement>('.video-wall video'),
]
const liveSources = (): string[] =>
  videos().map(v => v.getAttribute('src') ?? '')
const key = (k: string): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
}

beforeEach(() => {
  vi.resetModules()
  calls.length = 0
  reduced = false
  events = { close: 0, open: [] }
  fullscreen.requested = fullscreen.exited = 0
  localStorage.clear()
  document.body.innerHTML = ''
  bridge.getPreview.mockReset()
  bridge.getPreview.mockImplementation(async (id: number) => ({
    video: { fileId: id, path: `/m/${id}.mp4` },
    images: [],
  }))
  openMediaPlayer.mockClear()
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1920,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 1080,
  })
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    calls.push(`play:${this.getAttribute('src')}`)
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    calls.push(`pause:${this.getAttribute('src')}`)
  }
  HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
    calls.push(`load:${this.getAttribute('src') ?? ''}`)
  }
  HTMLElement.prototype.requestFullscreen = async function () {
    fullscreen.requested++
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: this,
    })
  }
  document.exitFullscreen = async () => {
    fullscreen.exited++
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
  }
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  })
})

afterEach(() => {
  app?.unmount()
  app = null
})

describe('视频墙', () => {
  it('9 部、宽屏：3×3 九格，默认只有 4 格真放视频（本地文件 local://）', async () => {
    const wall = await mount(9)
    expect(wall.querySelectorAll('.video-wall-tile')).toHaveLength(9)
    expect(videos()).toHaveLength(4)
    expect(liveSources().every(src => src.startsWith('local://'))).toBe(true)
    expect(fullscreen.requested).toBe(1)
    // 用键盘选格之前不显示选中框
    expect(wall.querySelector('.video-wall-tile.is-selected')).toBeNull()
  })

  it('只有缓存图的条目（网盘）、解码失败的影片不占播放名额', async () => {
    bridge.getPreview.mockImplementation(async (id: number) =>
      id === 2
        ? { video: null, images: [`yingbox-media://image/${'a'.repeat(32)}`] }
        : { video: { fileId: id, path: `/m/${id}.mp4` }, images: [] }
    )
    await mount(9)
    const tiles = document.querySelectorAll('.video-wall-tile')
    expect(tiles[1].querySelector('video')).toBeNull()
    expect(tiles[1].querySelector('img.video-wall-media')).not.toBeNull()
    expect(videos()).toHaveLength(4)
    tiles[0].querySelector('video')!.dispatchEvent(new Event('error'))
    await settle()
    expect(tiles[0].querySelector('video')).toBeNull()
    expect(videos()).toHaveLength(4)
    expect(tiles[5].querySelector('video')).not.toBeNull()
  })

  it('4 部：2×2', async () => {
    const wall = await mount(4)
    expect(wall.style.getPropertyValue('--wall-columns')).toBe('2')
  })

  it('数字键选格：选中格占播放名额，挤掉的那格清 src + load()', async () => {
    await mount(9)
    key('9')
    await settle()
    const tiles = document.querySelectorAll('.video-wall-tile')
    expect(tiles[8].classList.contains('is-selected')).toBe(true)
    expect(tiles[8].querySelector('video')).not.toBeNull()
    expect(tiles[3].querySelector('video')).toBeNull()
    expect(videos()).toHaveLength(4)
    expect(calls).toContain('load:')
  })

  it('方向键移动选格', async () => {
    await mount(9)
    key('ArrowRight')
    key('ArrowDown')
    await settle()
    const tiles = document.querySelectorAll('.video-wall-tile')
    expect(tiles[4].classList.contains('is-selected')).toBe(true)
  })

  it('空格暂停全部，再按继续', async () => {
    await mount(9)
    calls.length = 0
    key(' ')
    await settle()
    expect(calls.filter(c => c.startsWith('pause:'))).toHaveLength(4)
    calls.length = 0
    key(' ')
    await settle()
    expect(calls.filter(c => c.startsWith('play:'))).toHaveLength(4)
  })

  it('窗口隐藏（document.hidden）时全部暂停，回来继续', async () => {
    await mount(9)
    calls.length = 0
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(calls.filter(c => c.startsWith('pause:'))).toHaveLength(4)
    calls.length = 0
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(calls.filter(c => c.startsWith('play:'))).toHaveLength(4)
  })

  it('减少动态效果：只显示静态图，不建 video、不取预览', async () => {
    reduced = true
    await mount(9)
    expect(videos()).toHaveLength(0)
    expect(bridge.getPreview).not.toHaveBeenCalled()
  })

  it('同时播放上限可调，记进设置 ui.videoWallMaxLive', async () => {
    await mount(9)
    const two = [...document.querySelectorAll('button')].find(
      b => b.textContent?.trim() === '2'
    )
    two!.click()
    await settle()
    expect(videos()).toHaveLength(2)
    const { getSetting } =
      await import('../src/renderer/src/features/settings/use-setting')
    expect(getSetting('ui.videoWallMaxLive')).toBe(2)
  })

  it('设置里存的上限下次打开生效；不在档位里用默认 4', async () => {
    const { setSetting } =
      await import('../src/renderer/src/features/settings/use-setting')
    await setSetting('ui.videoWallMaxLive', 6)
    await mount(9)
    expect(videos()).toHaveLength(6)
    app!.unmount()
    await setSetting('ui.videoWallMaxLive', 3)
    await mount(9)
    expect(videos()).toHaveLength(4)
  })

  it('点格打开详情；回车打开选中格', async () => {
    await mount(9)
    const tiles = document.querySelectorAll<HTMLElement>('.video-wall-tile')
    tiles[2].querySelector<HTMLElement>('.video-wall-open')!.click()
    key('5')
    key('Enter')
    expect(events.open).toEqual([3, 5])
  })

  it('播放按钮：取条目详情，交给现有 openMediaPlayer，并暂停视频墙', async () => {
    await mount(9)
    const play = document.querySelectorAll<HTMLElement>(
      '.video-wall-tile [aria-label="播放"]'
    )[1]
    calls.length = 0
    play.click()
    await settle()
    expect(bridge.getItem).toHaveBeenCalledWith(2)
    expect(openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/m/2.mp4', title: '影片 2' })
    )
    expect(calls.filter(c => c.startsWith('pause:'))).toHaveLength(4)
  })

  it('Esc 关闭（按层）', async () => {
    await mount(9)
    key('Escape')
    expect(events.close).toBe(1)
  })

  it('全屏被系统退出（如 F11 / 浏览器 Esc）时也关闭', async () => {
    await mount(9)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(events.close).toBe(1)
  })

  it('卸载：每个 video 都去掉 src 并 load()，退出全屏', async () => {
    await mount(9)
    const all = videos()
    app!.unmount()
    app = null
    expect(all.every(v => !v.hasAttribute('src'))).toBe(true)
    expect(all.every(v => !v.isConnected)).toBe(true)
    expect(calls.filter(c => c === 'load:').length).toBeGreaterThanOrEqual(4)
    expect(fullscreen.exited).toBe(1)
  })
})
