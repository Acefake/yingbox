// @vitest-environment jsdom
/**
 * 播放器遥控（AI 助手用）：不在播放 / 外置播放器时只给说明；播放中开关弹幕、调不透明度走设置，
 * 字幕开关、倍速、跳过片头设在当前实例上，睡眠定时走 sleep-timer；问剧情交给登记的入口。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ set: vi.fn(async () => {}) }))
vi.mock('@/features/settings', () => ({
  setSetting: settings.set,
  getSetting: () => undefined,
  useSetting: () => ({ value: undefined }),
}))

import type Artplayer from 'artplayer'

import {
  closePlayerModal,
  openPlayerModal,
} from '../src/renderer/src/features/player/modal/player-modal'
import {
  askPlotQuestion,
  attachPlayerRemote,
  attachPlotQa,
  playerNowPlaying,
  playerRemoteState,
  runPlayerCommand,
} from '../src/renderer/src/features/player/remote/player-remote'
import { setSkipMarks } from '../src/renderer/src/features/player/skip/skip-store'

/** Artplayer 替身：只有遥控用到的字段 */
interface FakeArt {
  notice: { show: unknown }
  subtitle: { url: string; show: boolean }
  playbackRate: number
  currentTime: number
  seek: number
  setting: Record<string, ReturnType<typeof vi.fn>>
  video: { volume: number; paused: boolean; pause: ReturnType<typeof vi.fn> }
  on(name: string, fn: () => void): void
  emit(name: string): void
}

function fakeArt(subtitleUrl = ''): FakeArt {
  const handlers: Record<string, (() => void)[]> = {}
  return {
    notice: { show: '' as unknown },
    subtitle: { url: subtitleUrl, show: false },
    playbackRate: 1,
    currentTime: 30,
    seek: 0,
    setting: { add: vi.fn(), update: vi.fn(), find: vi.fn() },
    video: { volume: 1, paused: false, pause: vi.fn() },
    on(name: string, fn: () => void) {
      ;(handlers[name] ??= []).push(fn)
    },
    emit(name: string) {
      handlers[name]?.forEach(fn => fn())
    },
  }
}

let detach: (() => void) | null = null

beforeEach(() => {
  settings.set.mockClear()
})
afterEach(() => {
  detach?.()
  detach = null
  closePlayerModal()
})

const play = (isPrivate = false): void =>
  openPlayerModal({ url: 'local://a.mp4', private: isPrivate } as never)

describe('不在播放 / 外置播放器', () => {
  it('没有播放弹窗：说明没在播', () => {
    expect(playerRemoteState().playing).toBe(false)
    expect(runPlayerCommand({ kind: 'rate', value: 2 })).toEqual({
      ok: false,
      text: '现在没有正在播放的视频',
    })
  })

  it('有弹窗但没有内置实例（外置 mpv）：不能控制', () => {
    play()
    expect(playerRemoteState()).toMatchObject({
      playing: true,
      controllable: false,
    })
    expect(runPlayerCommand({ kind: 'danmaku', on: false }).ok).toBe(false)
    expect(settings.set).not.toHaveBeenCalled()
  })
})

describe('播放中', () => {
  it('弹幕开关与不透明度写设置，并在播放器上提示', () => {
    play()
    const art = fakeArt()
    detach = attachPlayerRemote({
      art: art as unknown as Artplayer,
      skipKey: () => '',
      title: () => '测试片',
      private: false,
    })
    expect(runPlayerCommand({ kind: 'danmaku', on: false })).toEqual({
      ok: true,
      text: '已关闭弹幕',
    })
    expect(settings.set).toHaveBeenCalledWith('danmaku.enabled', false)
    expect(art.notice.show).toBe('已关闭弹幕')
    runPlayerCommand({ kind: 'danmakuOpacity', value: 0.83 })
    expect(settings.set).toHaveBeenLastCalledWith('danmaku.opacity', 0.85)
  })

  it('字幕：没有字幕时说明，有字幕时切换显示', () => {
    play()
    const art = fakeArt()
    detach = attachPlayerRemote({
      art: art as unknown as Artplayer,
      skipKey: () => '',
      title: () => '测试片',
      private: false,
    })
    expect(runPlayerCommand({ kind: 'subtitle', on: true }).ok).toBe(false)
    art.subtitle.url = 'blob:sub'
    expect(runPlayerCommand({ kind: 'subtitle', on: true }).ok).toBe(true)
    expect(art.subtitle.show).toBe(true)
  })

  it('倍速夹到 0.25–4 并按 0.25 取整', () => {
    play()
    const art = fakeArt()
    detach = attachPlayerRemote({
      art: art as unknown as Artplayer,
      skipKey: () => '',
      title: () => '测试片',
      private: false,
    })
    runPlayerCommand({ kind: 'rate', value: 1.6 })
    expect(art.playbackRate).toBe(1.5)
    runPlayerCommand({ kind: 'rate', value: 9 })
    expect(art.playbackRate).toBe(4)
  })

  it('跳过片头：在片头里跳到片头结束，不在片头时说明', () => {
    play()
    const art = fakeArt()
    setSkipMarks('剧:test', { intro: { start: 10, end: 95 } })
    detach = attachPlayerRemote({
      art: art as unknown as Artplayer,
      skipKey: () => '剧:test',
      title: () => '测试片',
      private: false,
    })
    expect(runPlayerCommand({ kind: 'skipIntro' })).toEqual({
      ok: true,
      text: '已跳过片头',
    })
    expect(art.seek).toBe(95)
    art.currentTime = 200
    expect(runPlayerCommand({ kind: 'skipIntro' }).ok).toBe(false)
  })

  it('睡眠定时：没有装定时菜单的实例时说明', () => {
    play()
    detach = attachPlayerRemote({
      art: fakeArt() as unknown as Artplayer,
      skipKey: () => '',
      title: () => '测试片',
      private: false,
    })
    expect(runPlayerCommand({ kind: 'sleep', choice: 30 }).ok).toBe(false)
  })

  it('实例销毁后自动撤下；私密播放标记', () => {
    play(true)
    const art = fakeArt()
    detach = attachPlayerRemote({
      art: art as unknown as Artplayer,
      skipKey: () => '',
      title: () => '测试片',
      private: true,
    })
    expect(playerRemoteState()).toMatchObject({
      controllable: true,
      private: true,
    })
    expect(playerNowPlaying()).toEqual({
      title: '测试片',
      seconds: 30,
      private: true,
    })
    art.emit('destroy')
    expect(playerRemoteState().controllable).toBe(false)
    expect(playerNowPlaying()).toBeNull()
  })
})

describe('问剧情', () => {
  it('播放中交给登记的入口；撤下或不在播放时返回 false', () => {
    const ask = vi.fn(() => true)
    const off = attachPlotQa(ask)
    expect(askPlotQuestion('他是谁')).toBe(false)
    play()
    expect(askPlotQuestion('他是谁')).toBe(true)
    expect(ask).toHaveBeenCalledWith('他是谁')
    off()
    expect(askPlotQuestion('他是谁')).toBe(false)
  })
})
