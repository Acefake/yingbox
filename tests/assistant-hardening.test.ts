/**
 * AI 助手的健壮性：快捷键换绑失败保留旧组合、被外部注销后自愈、按键自动重复不算、
 * 设置页状态未知时不显示、WAV 带附加块的时长、焦点陷阱的 Tab 落点、
 * 逐字显示被取消时 ask() 结算、停止录音期间取消不再转写、录满上限自动转写、回执记进上下文、
 * 私密技能登记到一半出错全部卸掉、录音临时目录清扫、打包检查脚本的入口 / 字面量 / 参数解析。
 */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('../src/main/ai-subtitles', () => ({ speechRecognizer: vi.fn() }))

import {
  dirOption,
  entryChunk,
  sensitiveHit,
} from '../scripts/check-assistant-chunks.mjs'
import {
  type ShortcutRegistry,
  createShortcutController,
  wavSeconds,
} from '../src/main/assistant/rules'
import { sweepVoiceTemp } from '../src/main/assistant/transcribe'
import {
  isAssistantHotkey,
  shortcutStatusText,
} from '../src/renderer/src/features/assistant/assistant-hotkey'
import {
  VOICE_SAMPLE_RATE,
  encodeWav,
} from '../src/renderer/src/features/assistant/assistant-voice'
import { installPrivateSkills } from '../src/renderer/src/features/assistant/private-skills'
import { createSkillRegistry } from '../src/renderer/src/features/assistant/skills/skill-registry'
import type { AssistantSkill } from '../src/renderer/src/features/assistant/skills/skill-types'
import {
  type AssistantDeps,
  useAssistant,
} from '../src/renderer/src/features/assistant/use-assistant'
import { trapTarget } from '../src/renderer/src/composables/use-focus-trap'

/** 假的 globalShortcut：taken 里的组合被别的程序占用 */
function fakeRegistry(
  taken: string[] = []
): ShortcutRegistry & { active: Map<string, () => void> } {
  const active = new Map<string, () => void>()
  return {
    active,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator)) return false
      active.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => void active.delete(accelerator)),
    isRegistered: (accelerator: string) => active.has(accelerator),
  }
}

describe('全局快捷键', () => {
  it('换绑到被占用的组合：旧组合继续生效，状态给出 active', () => {
    const registry = fakeRegistry(['Alt+J'])
    const shortcut = createShortcutController(registry, vi.fn())
    shortcut.apply('Alt+Space')
    expect(shortcut.apply('Alt+J')).toEqual({
      accelerator: 'Alt+J',
      registered: false,
      problem: 'conflict',
      active: 'Alt+Space',
    })
    expect([...registry.active.keys()]).toEqual(['Alt+Space'])
    expect(shortcut.apply('Alt+').active).toBe('Alt+Space')
    expect(shortcut.apply('Alt+K').registered).toBe(true)
    expect([...registry.active.keys()]).toEqual(['Alt+K'])
  })

  it('被外部注销（unregisterAll）后：status 以系统为准并重新注册，同一写法再 apply 也会注册', () => {
    const registry = fakeRegistry()
    const shortcut = createShortcutController(registry, vi.fn())
    shortcut.apply('Alt+Space')
    registry.active.clear()
    expect(shortcut.status()).toEqual({
      accelerator: 'Alt+Space',
      registered: true,
    })
    expect(registry.active.has('Alt+Space')).toBe(true)
    registry.active.clear()
    expect(shortcut.apply('Alt+Space').registered).toBe(true)
    expect(registry.register).toHaveBeenCalledTimes(3)
  })

  it('按住不放的自动重复不算唤起', () => {
    const base = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    }
    expect(isAssistantHotkey(base)).toBe(true)
    expect(isAssistantHotkey({ ...base, repeat: true })).toBe(false)
  })

  it('设置页：还没取到状态不显示；换绑失败时说明旧组合仍在用', () => {
    expect(shortcutStatusText(null)).toEqual({ kind: 'unknown', text: '' })
    expect(
      shortcutStatusText({
        accelerator: 'Alt+J',
        registered: false,
        problem: 'conflict',
        active: 'Alt+Space',
      }).text
    ).toContain('当前仍使用 Alt+Space')
  })
})

describe('WAV 时长', () => {
  it('data 前有 LIST 附加块时按 data 块长度算', () => {
    const plain = encodeWav(
      new Float32Array(VOICE_SAMPLE_RATE),
      VOICE_SAMPLE_RATE
    )
    const list = new Uint8Array(8 + 26)
    list.set([...'LIST'].map(c => c.charCodeAt(0)))
    new DataView(list.buffer).setUint32(4, 26, true)
    const withList = new Uint8Array(plain.byteLength + list.byteLength)
    withList.set(plain.subarray(0, 36))
    withList.set(list, 36)
    withList.set(plain.subarray(36), 36 + list.byteLength)
    expect(wavSeconds(plain)).toBeCloseTo(1)
    expect(wavSeconds(withList)).toBeCloseTo(1)
    expect(wavSeconds(withList.subarray(0, 40))).toBe(0)
  })
})

describe('焦点陷阱', () => {
  it('Tab 在首尾之间循环，中间交给浏览器', () => {
    const items = ['a', 'b', 'c']
    expect(trapTarget(items, 'c', false)).toBe('a')
    expect(trapTarget(items, 'a', true)).toBe('c')
    expect(trapTarget(items, 'b', false)).toBeNull()
    expect(trapTarget(items, 'x', false)).toBe('a')
    expect(trapTarget([], 'a', false)).toBeNull()
  })
})

/** 最小依赖：动作返回固定结果 */
function deps(overrides: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    context: () => ({
      route: { path: '/', title: '在线' },
      playing: false,
      controllable: false,
      plotQa: false,
      private: false,
      nowPlaying: null,
    }),
    skills: () => [],
    aiReady: () => true,
    classify: vi.fn(async () => ({
      intent: {
        kind: 'action' as const,
        id: 't.a',
        action: {
          name: 'a',
          describe: '',
          parse: () => true,
          run: async () => ({ message: '好的，马上', result: null }),
        },
        params: true,
      },
      reply: '',
    })),
    stream: vi.fn(async () => {}),
    env: signal => ({ router: {} as never, openSettings: vi.fn(), signal }),
    close: vi.fn(),
    revealMs: () => 50,
    ...overrides,
  }
}

describe('useAssistant 的收尾', () => {
  it('逐字显示中取消：ask() 当场结算，不会悬着', async () => {
    vi.useFakeTimers()
    const a = useAssistant(deps())
    let settled = false
    const done = a.ask('来一部').then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(60)
    expect(a.phase.value).toBe('answering')
    a.cancel()
    await vi.advanceTimersByTimeAsync(0)
    await done
    expect(settled).toBe(true)
    expect(a.phase.value).toBe('idle')
    vi.useRealTimers()
  })

  it('回执类结果没有 message 时，把回执文字记进对话上下文', async () => {
    const remember = vi.fn()
    const a = useAssistant(
      deps({
        remember,
        revealMs: () => 0,
        classify: vi.fn(async () => ({
          intent: {
            kind: 'action' as const,
            id: 'p.c',
            action: {
              name: 'c',
              describe: '',
              parse: () => true,
              run: async () => ({
                message: '',
                result: {
                  kind: 'done' as const,
                  ok: true,
                  icon: 'check' as const,
                  text: '已关闭弹幕',
                },
              }),
            },
            params: true,
          },
          reply: '',
        })),
      })
    )
    await a.ask('关弹幕')
    expect(remember).toHaveBeenCalledWith('关弹幕', '已关闭弹幕', false)
    expect(a.answer.value).toBe('')
  })

  it('停止录音期间被取消：录音不再交去转写', async () => {
    let finish: (audio: Uint8Array) => void = () => {}
    const session = {
      stop: vi.fn(() => new Promise<Uint8Array>(resolve => (finish = resolve))),
      cancel: vi.fn(),
    }
    const transcribe = vi.fn(async () => '今晚看什么')
    const a = useAssistant(
      deps({ voice: { start: vi.fn(async () => session), transcribe } })
    )
    await a.listen()
    const stopping = a.stopListening()
    a.cancel()
    finish(new Uint8Array([1]))
    await stopping
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('录满上限：自动停止并转写提问', async () => {
    let limit: () => void = () => {}
    const session = {
      stop: vi.fn(async () => new Uint8Array([1])),
      cancel: vi.fn(),
    }
    const transcribe = vi.fn(async () => '今晚看什么')
    const a = useAssistant(
      deps({
        revealMs: () => 0,
        voice: {
          start: vi.fn(async (_onLevel, onLimit) => {
            limit = onLimit!
            return session
          }),
          transcribe,
        },
      })
    )
    await a.listen()
    limit()
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce())
    expect(session.stop).toHaveBeenCalledOnce()
  })
})

describe('私密技能登记', () => {
  it('登记到一半抛错：已登记的全部卸掉', async () => {
    const registry = createSkillRegistry()
    const register = registry.register
    const skill = (id: string): AssistantSkill => ({
      id,
      scope: 'private',
      actions: [],
    })
    registry.register = s => {
      if (s.id === 'b') throw new Error('坏技能')
      register(s)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const on = ref(true)
    const stop = installPrivateSkills({
      enabled: () => on.value,
      load: async () => ({ default: [skill('a'), skill('b')] }),
      registry,
    })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    await nextTick()
    expect(registry.list()).toEqual([])
    stop()
    warn.mockRestore()
  })
})

describe('录音临时目录清扫', () => {
  it('只删 yingbox-voice-* 目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sweep-'))
    mkdirSync(join(root, 'yingbox-voice-abc'))
    writeFileSync(join(root, 'yingbox-voice-abc', 'voice.wav'), 'x')
    mkdirSync(join(root, 'other'))
    await sweepVoiceTemp(root)
    expect(readdirSync(root)).toEqual(['other'])
  })
})

describe('打包隔离检查脚本', () => {
  it('入口取 type=module 的 script，不误认 modulepreload', () => {
    const html = [
      '<link rel="modulepreload" href="./assets/vendor-1.js">',
      '<script src="./legacy.js"></script>',
      '<script type="module" crossorigin src="./assets/index-2.js"></script>',
    ].join('\n')
    expect(entryChunk(html)).toBe('index-2.js')
    expect(entryChunk('<html></html>')).toBe('')
  })

  it('只查字符串字面量：压缩后的短变量名不误报', () => {
    expect(sensitiveHit('function(av,jav){return av+jav}')).toBeNull()
    expect(sensitiveHit('const t="去 av 页面"')).toBe('av')
  })

  it('--dir 缺值时返回 null；没给用默认目录', () => {
    expect(dirOption(['node', 'x', '--dir'])).toBeNull()
    expect(dirOption(['node', 'x', '--dir', '--other'])).toBeNull()
    expect(dirOption(['node', 'x', '--dir', 'dist'])).toBe('dist')
    expect(dirOption(['node', 'x'])).toContain('renderer')
  })
})
