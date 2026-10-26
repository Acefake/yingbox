/**
 * AI 助手的全局快捷键与语音：写法校验与规整、注册 / 冲突 / 写法不对 / 关闭 / 换绑、
 * 应用内 Cmd/Ctrl+K / Cmd/Ctrl+Shift+K 判定与设置页提示、WAV 编码与时长、转写文字拼接。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  type ShortcutRegistry,
  createShortcutController,
  normalizeAccelerator,
  transcriptText,
  wavSeconds,
} from '../src/main/assistant/rules'
import {
  entryHotkey,
  shortcutStatusText,
} from '../src/renderer/src/features/assistant/assistant-hotkey'
import {
  VOICE_SAMPLE_RATE,
  encodeWav,
  rmsLevel,
} from '../src/renderer/src/features/assistant/assistant-voice'

describe('normalizeAccelerator', () => {
  it('规整大小写、别名与修饰键顺序', () => {
    expect(normalizeAccelerator('alt+space')).toBe('Alt+Space')
    expect(normalizeAccelerator(' Shift + cmdorctrl + k ')).toBe(
      'CommandOrControl+Shift+K'
    )
    expect(normalizeAccelerator('Option+Cmd+J')).toBe('Command+Alt+J')
    expect(normalizeAccelerator('ctrl+esc')).toBe('Control+Escape')
    expect(normalizeAccelerator('F9')).toBe('F9')
  })

  it('空串表示关闭', () => {
    expect(normalizeAccelerator('')).toBe('')
    expect(normalizeAccelerator('   ')).toBe('')
  })

  it('不合法的写法返回 null', () => {
    for (const bad of [
      'K',
      'Space',
      'Alt',
      'Alt+',
      'Alt++K',
      'Alt+K+J',
      'Alt+Hyper',
      'Ctrl+F25',
      'Alt+中',
    ])
      expect(normalizeAccelerator(bad), bad).toBeNull()
  })
})

/** 假的 globalShortcut：taken 里的组合被别的程序占用，invalid 里的会抛错 */
function fakeRegistry(
  taken: string[] = [],
  invalid: string[] = []
): ShortcutRegistry & { active: Map<string, () => void> } {
  const active = new Map<string, () => void>()
  return {
    active,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (invalid.includes(accelerator)) throw new Error('bad accelerator')
      if (taken.includes(accelerator)) return false
      active.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => void active.delete(accelerator)),
    isRegistered: (accelerator: string) => active.has(accelerator),
  }
}

describe('createShortcutController', () => {
  it('注册成功后按下快捷键触发唤起', () => {
    const registry = fakeRegistry()
    const onTrigger = vi.fn()
    const shortcut = createShortcutController(registry, onTrigger)
    expect(shortcut.apply('alt+space')).toEqual({
      accelerator: 'Alt+Space',
      registered: true,
    })
    registry.active.get('Alt+Space')!()
    expect(onTrigger).toHaveBeenCalledOnce()
  })

  it('被其他程序占用：不注册，报告 conflict', () => {
    const shortcut = createShortcutController(
      fakeRegistry(['Alt+Space']),
      vi.fn()
    )
    expect(shortcut.apply('Alt+Space')).toEqual({
      accelerator: 'Alt+Space',
      registered: false,
      problem: 'conflict',
    })
  })

  it('本应用其他功能已占用（如 F12）：不抢，报告 conflict', () => {
    const registry = fakeRegistry()
    registry.active.set('F12', vi.fn())
    const shortcut = createShortcutController(registry, vi.fn())
    expect(shortcut.apply('F12').problem).toBe('conflict')
    expect(registry.register).not.toHaveBeenCalled()
  })

  it('写法不对或系统不接受：报告 invalid', () => {
    const shortcut = createShortcutController(
      fakeRegistry([], ['Super+K']),
      vi.fn()
    )
    expect(shortcut.apply('Alt+').problem).toBe('invalid')
    expect(shortcut.apply('Super+K').problem).toBe('invalid')
  })

  it('换绑注销旧组合；关闭（空串）注销且不报错；同一组合不重复注册', () => {
    const registry = fakeRegistry()
    const shortcut = createShortcutController(registry, vi.fn())
    shortcut.apply('Alt+Space')
    shortcut.apply('Alt+Space')
    expect(registry.register).toHaveBeenCalledTimes(1)
    shortcut.apply('Control+Shift+K')
    expect([...registry.active.keys()]).toEqual(['Control+Shift+K'])
    expect(shortcut.apply('')).toEqual({ accelerator: '', registered: false })
    expect(registry.active.size).toBe(0)
  })

  it('冲突后改成可用的组合能恢复；dispose 注销', () => {
    const registry = fakeRegistry(['Alt+Space'])
    const shortcut = createShortcutController(registry, vi.fn())
    shortcut.apply('Alt+Space')
    expect(shortcut.apply('Alt+J').registered).toBe(true)
    shortcut.dispose()
    expect(registry.active.size).toBe(0)
    expect(shortcut.status().registered).toBe(false)
  })
})

describe('应用内快捷键与设置页提示', () => {
  const key = (
    k: string,
    mods: Partial<KeyboardEvent> = {}
  ): Parameters<typeof entryHotkey>[0] => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    ...mods,
  })

  it('Cmd/Ctrl+Shift+K 与 Cmd/Ctrl+K 都唤起统一入口，不带修饰键或带 Alt 或输入法组字中不算', () => {
    expect(entryHotkey(key('k', { ctrlKey: true }))).toBe('toggle')
    expect(entryHotkey(key('K', { metaKey: true }))).toBe('toggle')
    expect(entryHotkey(key('k'))).toBeNull()
    expect(entryHotkey(key('k', { ctrlKey: true, shiftKey: false }))).toBe(
      'toggle'
    )
    expect(entryHotkey(key('k', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(
      entryHotkey({ ...key('k', { ctrlKey: true }), isComposing: true })
    ).toBeNull()
  })

  it('状态提示：已启用 / 关闭 / 冲突 / 写法不对', () => {
    expect(
      shortcutStatusText({ accelerator: 'Alt+Space', registered: true }).kind
    ).toBe('ok')
    expect(
      shortcutStatusText({ accelerator: '', registered: false }).kind
    ).toBe('off')
    expect(
      shortcutStatusText({
        accelerator: 'Alt+Space',
        registered: false,
        problem: 'conflict',
      })
    ).toEqual({ kind: 'warn', text: expect.stringContaining('占用') })
    expect(
      shortcutStatusText({
        accelerator: 'Alt+',
        registered: false,
        problem: 'invalid',
      }).text
    ).toContain('不是有效')
  })
})

describe('语音：WAV 与转写文字', () => {
  it('encodeWav 写出标准头，wavSeconds 读回时长', () => {
    const samples = new Float32Array(VOICE_SAMPLE_RATE / 2).fill(0.5)
    const wav = encodeWav(samples, VOICE_SAMPLE_RATE)
    expect(wav.byteLength).toBe(44 + samples.length * 2)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(wavSeconds(wav)).toBeCloseTo(0.5)
    expect(wavSeconds(new Uint8Array(10))).toBe(0)
    expect(wavSeconds(new Uint8Array(100))).toBe(0)
  })

  it('越界采样截顶，音量按均方根换算到 0–1', () => {
    const wav = encodeWav(new Float32Array([2, -2]), VOICE_SAMPLE_RATE)
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(rmsLevel([])).toBe(0)
    expect(rmsLevel([0.1, -0.1])).toBeCloseTo(0.4)
    expect(rmsLevel([1, -1])).toBe(1)
  })

  it('转写各段拼成一句：去空段，中文不加空格，英文单词间加空格', () => {
    expect(
      transcriptText([
        { text: ' 今晚 ' },
        { text: '' },
        { text: '看什么' },
        { text: 'Star' },
        { text: 'Wars' },
      ])
    ).toBe('今晚看什么Star Wars')
  })
})
