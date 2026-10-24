import { describe, expect, it } from 'vitest'

import {
  RATE_STEPS,
  dblclickZone,
  isTypingTarget,
  resolveHotkey,
  stepRate,
} from '../src/renderer/src/features/player/hotkeys/hotkey-map'

/** 键盘事件的最小形状 */
const key = (
  k: string,
  extra: Partial<Parameters<typeof resolveHotkey>[0]> = {}
): Parameters<typeof resolveHotkey>[0] => ({ key: k, ...extra })

describe('播放器快捷键映射', () => {
  it('空格 / K 播放暂停，J / L ±10 秒，← / → ±5 秒', () => {
    expect(resolveHotkey(key(' '))).toEqual({ kind: 'toggle' })
    expect(resolveHotkey(key('k'))).toEqual({ kind: 'toggle' })
    expect(resolveHotkey(key('K'))).toEqual({ kind: 'toggle' })
    expect(resolveHotkey(key('j'))).toEqual({ kind: 'seek', delta: -10 })
    expect(resolveHotkey(key('l'))).toEqual({ kind: 'seek', delta: 10 })
    expect(resolveHotkey(key('ArrowLeft'))).toEqual({ kind: 'seek', delta: -5 })
    expect(resolveHotkey(key('ArrowRight'))).toEqual({ kind: 'seek', delta: 5 })
  })

  it('↑ / ↓ 音量 ±5%，M 静音，F 全屏，I 小窗，C 字幕', () => {
    expect(resolveHotkey(key('ArrowUp'))).toEqual({
      kind: 'volume',
      delta: 0.05,
    })
    expect(resolveHotkey(key('ArrowDown'))).toEqual({
      kind: 'volume',
      delta: -0.05,
    })
    expect(resolveHotkey(key('m'))).toEqual({ kind: 'mute' })
    expect(resolveHotkey(key('f'))).toEqual({ kind: 'fullscreen' })
    expect(resolveHotkey(key('i'))).toEqual({ kind: 'mini' })
    expect(resolveHotkey(key('c'))).toEqual({ kind: 'subtitle' })
  })

  it('0–9 跳到 0%–90%', () => {
    expect(resolveHotkey(key('0'))).toEqual({ kind: 'seekTo', fraction: 0 })
    expect(resolveHotkey(key('5'))).toEqual({ kind: 'seekTo', fraction: 0.5 })
    expect(resolveHotkey(key('9'))).toEqual({ kind: 'seekTo', fraction: 0.9 })
  })

  it('< > 调速，Shift+N 下一集，单独 N 不触发', () => {
    expect(resolveHotkey(key('<', { shiftKey: true }))).toEqual({
      kind: 'rate',
      dir: -1,
    })
    expect(resolveHotkey(key('>', { shiftKey: true }))).toEqual({
      kind: 'rate',
      dir: 1,
    })
    expect(resolveHotkey(key('N', { shiftKey: true }))).toEqual({
      kind: 'next',
    })
    expect(resolveHotkey(key('n'))).toBeNull()
  })

  it('输入法组字中（isComposing 或 keyCode 229）不触发', () => {
    expect(resolveHotkey(key('k', { isComposing: true }))).toBeNull()
    expect(resolveHotkey(key('Process', { keyCode: 229 }))).toBeNull()
    expect(resolveHotkey(key(' ', { keyCode: 229 }))).toBeNull()
  })

  it('焦点在输入框 / 文本域 / 可编辑区时不触发', () => {
    expect(
      resolveHotkey(key('k', { target: { tagName: 'INPUT' } as never }))
    ).toBeNull()
    expect(
      resolveHotkey(key(' ', { target: { tagName: 'TEXTAREA' } as never }))
    ).toBeNull()
    expect(
      resolveHotkey(
        key('f', {
          target: { tagName: 'DIV', isContentEditable: true } as never,
        })
      )
    ).toBeNull()
    expect(
      resolveHotkey(key('f', { target: { tagName: 'DIV' } as never }))
    ).toEqual({ kind: 'fullscreen' })
  })

  it('带 Ctrl / ⌘ / Alt 的组合键留给系统与应用', () => {
    expect(resolveHotkey(key('c', { ctrlKey: true }))).toBeNull()
    expect(resolveHotkey(key('f', { metaKey: true }))).toBeNull()
    expect(resolveHotkey(key('ArrowLeft', { altKey: true }))).toBeNull()
  })

  it('isTypingTarget 识别可输入元素', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({ tagName: 'SELECT' } as never)).toBe(true)
    expect(isTypingTarget({ tagName: 'BUTTON' } as never)).toBe(false)
  })
})

describe('倍速档位', () => {
  it('按档位升降，到头不再变', () => {
    // 与 Artplayer 内置「播放速度」菜单同一组档位（art-core 把 Artplayer.PLAYBACK_RATE 设为它）
    expect(RATE_STEPS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
    expect(stepRate(1, 1)).toBe(1.25)
    expect(stepRate(1, -1)).toBe(0.75)
    expect(stepRate(2, 1)).toBe(2)
    expect(stepRate(0.5, -1)).toBe(0.5)
    expect(stepRate(0.25, 1)).toBe(0.5)
  })

  it('不在档位上的倍速吸到相邻档位', () => {
    expect(stepRate(1.1, 1)).toBe(1.25)
    expect(stepRate(1.1, -1)).toBe(1)
    expect(stepRate(3, -1)).toBe(2)
  })
})

describe('双击手势区域', () => {
  it('左三分之一后退、右三分之一快进、中间全屏', () => {
    expect(dblclickZone(10, 900)).toBe('back')
    expect(dblclickZone(299, 900)).toBe('back')
    expect(dblclickZone(450, 900)).toBe('fullscreen')
    expect(dblclickZone(601, 900)).toBe('forward')
    expect(dblclickZone(100, 0)).toBe('fullscreen')
  })
})
