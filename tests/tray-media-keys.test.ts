// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MEDIA_KEY_COMMANDS,
  clipTitle,
  shouldGrabMediaKeys,
  trayMenu,
  trayTooltip,
} from '../src/main/tray/rules'
import { usePlayerMediaControls } from '../src/renderer/src/features/player/composables/use-media-controls'
import {
  createCommandGate,
  previousAction,
  stepTarget,
} from '../src/renderer/src/features/player/utils/media-commands'
import { type NowPlaying, parseNowPlaying } from '../src/shared/now-playing'

/**
 * 托盘 + 全局媒体键：菜单与提示文字、媒体键注册条件、播放命令规则、状态解析，
 * 以及播放会话的 composable（命令 → 换集 / 播放暂停，状态上报，卸载清理）。
 * test-affected: repo-wide（读源码断言接线）
 */

const root = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

const playing: NowPlaying = {
  title: '第 3 集',
  playing: true,
  hasNext: true,
  hasPrevious: true,
}

describe('托盘规则', () => {
  it('没在播：标题行提示无内容，播放 / 下一集置灰，显示主窗口与退出可用', () => {
    const menu = trayMenu(null)
    expect(menu[0]).toEqual({ type: 'label', label: '没有正在播放的内容' })
    const actions = menu.filter(item => item.type === 'action')
    expect(actions.map(item => [item.action, item.enabled])).toEqual([
      ['playpause', false],
      ['next', false],
      ['show', true],
      ['quit', true],
    ])
  })

  it('在播：显示标题，按钮文案跟播放状态走，没有下一集时置灰', () => {
    expect(trayMenu(playing)[0]).toEqual({
      type: 'label',
      label: '正在播放：第 3 集',
    })
    const paused = trayMenu({ ...playing, playing: false, hasNext: false })
    const toggle = paused.find(
      item => item.type === 'action' && item.action === 'playpause'
    )
    const next = paused.find(
      item => item.type === 'action' && item.action === 'next'
    )
    expect(toggle).toMatchObject({ label: '播放', enabled: true })
    expect(next).toMatchObject({ enabled: false })
    expect(
      trayMenu(playing).find(
        item => item.type === 'action' && item.action === 'playpause'
      )
    ).toMatchObject({ label: '暂停' })
  })

  it('长标题截断，按字符而不是 UTF-16 单元', () => {
    expect(clipTitle('一二三四五', 4)).toBe('一二三…')
    expect(clipTitle('😀😀😀', 3)).toBe('😀😀😀')
    expect(clipTitle('  短  ')).toBe('短')
  })

  it('提示文字：应用名 + 状态 + 标题', () => {
    expect(trayTooltip(null)).toBe('影盒')
    expect(trayTooltip(playing)).toBe('影盒 · 正在播放：第 3 集')
    expect(trayTooltip({ ...playing, playing: false })).toBe(
      '影盒 · 已暂停：第 3 集'
    )
  })

  it('媒体键：三个键对应三条命令；只有开关打开、在播且系统允许时才注册', () => {
    expect(MEDIA_KEY_COMMANDS).toEqual([
      ['MediaPlayPause', 'playpause'],
      ['MediaNextTrack', 'next'],
      ['MediaPreviousTrack', 'previous'],
    ])
    const base = { enabled: true, state: playing, permitted: true }
    expect(shouldGrabMediaKeys(base)).toBe(true)
    expect(shouldGrabMediaKeys({ ...base, enabled: false })).toBe(false)
    expect(shouldGrabMediaKeys({ ...base, state: null })).toBe(false)
    expect(shouldGrabMediaKeys({ ...base, permitted: false })).toBe(false)
    // 暂停中也算在播：媒体键要能继续播放
    expect(
      shouldGrabMediaKeys({ ...base, state: { ...playing, playing: false } })
    ).toBe(true)
  })
})

describe('播放状态解析', () => {
  it('合法状态去空白、限长；null 表示没在播；外形不对返回 undefined', () => {
    expect(parseNowPlaying(null)).toBeNull()
    expect(parseNowPlaying({ ...playing, title: '  a  ' })).toEqual({
      ...playing,
      title: 'a',
    })
    expect(
      parseNowPlaying({ ...playing, title: 'x'.repeat(500) })?.title
    ).toHaveLength(200)
    expect(parseNowPlaying({ ...playing, playing: 'yes' })).toBeUndefined()
    expect(parseNowPlaying({ title: 1 })).toBeUndefined()
    expect(parseNowPlaying([])).toBeUndefined()
    expect(parseNowPlaying(undefined)).toBeUndefined()
  })
})

describe('播放命令规则', () => {
  it('上一集：播过 3 秒或已是第一集时回到开头，否则切上一集', () => {
    expect(previousAction(10, 2)).toBe('restart')
    expect(previousAction(1, 2)).toBe('previous')
    expect(previousAction(1, 0)).toBe('restart')
  })

  it('换集目标越界返回 null', () => {
    expect(stepTarget(0, 3, 1)).toBe(1)
    expect(stepTarget(2, 3, 1)).toBeNull()
    expect(stepTarget(0, 3, -1)).toBeNull()
  })

  it('同一命令 300ms 内重复只执行一次，不同命令不受影响', () => {
    let now = 1000
    const pass = createCommandGate(() => now)
    expect(pass('playpause')).toBe(true)
    now += 100
    expect(pass('playpause')).toBe(false)
    expect(pass('next')).toBe(true)
    now += 400
    expect(pass('next')).toBe(true)
    expect(pass('playpause')).toBe(true)
  })
})

describe('usePlayerMediaControls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as { api?: unknown }).api
  })

  function mount(): {
    position: ReturnType<typeof ref<number>>
    load: ReturnType<typeof vi.fn>
    report: ReturnType<typeof vi.fn>
    send: (command: string) => void
    attach: (video: HTMLVideoElement) => void
    onVideo: ReturnType<typeof vi.fn>
    unmount: () => void
  } {
    let listener: ((command: string) => void) | null = null
    const report = vi.fn(async () => {})
    const offCommand = vi.fn()
    ;(window as { api?: unknown }).api = {
      nowPlaying: {
        report,
        onCommand: (cb: (command: string) => void) => {
          listener = cb
        },
        offCommand,
      },
    }
    const position = ref(1)
    const load = vi.fn(async () => {})
    const onVideo = vi.fn()
    let attach: (video: HTMLVideoElement) => void = () => {}
    const app = createApp(
      defineComponent({
        setup() {
          attach = usePlayerMediaControls({
            playlist: ref(['a', 'b', 'c']),
            position,
            activeFallback: ref(0),
            load,
            title: () => `集 ${position.value}`,
            poster: ref(''),
            onVideo,
          }).attach
          return () => null
        },
      })
    )
    app.mount(document.createElement('div'))
    return {
      position,
      load,
      report,
      send: command => listener?.(command),
      attach: video => attach(video),
      onVideo,
      unmount: () => app.unmount(),
    }
  }

  it('下一集 / 上一集命令换集并加载；状态变化后上报普通对象', async () => {
    vi.useFakeTimers()
    const ctx = mount()
    await nextTick()
    expect(ctx.report).toHaveBeenLastCalledWith({
      title: '集 1',
      playing: false,
      hasNext: true,
      hasPrevious: true,
    })
    ctx.send('next')
    expect(ctx.position.value).toBe(2)
    expect(ctx.load).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(ctx.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '集 2', hasNext: false })
    )
    ctx.send('next') // 已是最后一集
    expect(ctx.position.value).toBe(2)
    vi.advanceTimersByTime(400)
    ctx.send('previous')
    expect(ctx.position.value).toBe(1)
    vi.useRealTimers()
    ctx.unmount()
  })

  it('播放 / 暂停切换 <video>；attach 把 <video> 交给外层；卸载时报 null 并退订', async () => {
    const ctx = mount()
    const video = document.createElement('video')
    const play = vi.fn(async () => {})
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.play = play
    ctx.attach(video)
    expect(ctx.onVideo).toHaveBeenCalledWith(video)
    ctx.send('playpause')
    expect(play).toHaveBeenCalledTimes(1)
    ctx.unmount()
    expect(ctx.report).toHaveBeenLastCalledWith(null)
    expect(
      (window as { api?: { nowPlaying: { offCommand: () => void } } }).api
        ?.nowPlaying.offCommand
    ).toHaveBeenCalled()
  })
})

describe('接线', () => {
  it('主进程：bootstrap 调 installTray；托盘模块经契约推命令，不直接 webContents.send', () => {
    expect(read('src/main/index.ts')).toMatch(/installTray\(\{/)
    const tray = read('src/main/tray/index.ts')
    expect(tray).toMatch(/implement\(nowPlaying/)
    expect(tray).toMatch(/emit\(nowPlaying, 'command'/)
    expect(tray).not.toMatch(/\.send\(/)
    expect(tray).not.toMatch(/before-quit/)
  })

  it('PlayerSession 只接一次 composable，<video> 经 attach 交出去', () => {
    const session = read(
      'src/renderer/src/features/player/components/PlayerSession.vue'
    )
    expect(session).toMatch(/usePlayerMediaControls\(\{/)
    expect(session).toMatch(/@ready="media\.attach"/)
  })

  it('设置：两个开关在 schema 里，播放器设置页桌面端显示', () => {
    const schema = read('src/shared/settings/schema.ts')
    expect(schema).toMatch(/'app\.tray': bool\(true\)/)
    expect(schema).toMatch(/'player\.mediaKeys': bool\(true\)/)
    const page = read(
      'src/renderer/src/features/settings/sections/PlayerSettings.vue'
    )
    expect(page).toMatch(/useSetting\('app\.tray'\)/)
    expect(page).toMatch(/useSetting\('player\.mediaKeys'\)/)
    expect(page).toMatch(/v-if="isElectron" title="系统集成"/)
  })
})
