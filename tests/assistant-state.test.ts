/**
 * AI 助手状态机：阶段转移表、一次提问的流转（动作 / 流式回答 / 说明）、未配置 AI、
 * 取消与新提问丢弃迟到结果、模型错误提示、语音录入（音量 → 转写 → 提问）。依赖全部是替身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiCallError } from '../src/renderer/src/features/ai'
import type { ActionOutcome } from '../src/renderer/src/features/assistant/assistant-actions'
import type {
  AssistantContext,
  ParsedIntent,
} from '../src/renderer/src/features/assistant/assistant-intents'
import {
  type AssistantDeps,
  type AssistantPhase,
  errorText,
  nextPhase,
  useAssistant,
} from '../src/renderer/src/features/assistant/use-assistant'

const context: AssistantContext = {
  playing: false,
  controllable: false,
  plotQa: false,
  private: false,
}

/** 可手动放行的 Promise */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeDeps(overrides: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    context: () => context,
    aiReady: () => true,
    classify: vi.fn(
      async (): Promise<ParsedIntent> => ({
        intent: { kind: 'continue' },
        reply: '好的',
      })
    ),
    stream: vi.fn(async () => {}),
    execute: vi.fn(
      async (): Promise<ActionOutcome> => ({
        message: '接着看',
        result: null,
      })
    ),
    close: vi.fn(),
    voice: null,
    revealMs: () => 0,
    ...overrides,
  }
}

describe('nextPhase', () => {
  it('合法转移', () => {
    const steps: [
      AssistantPhase,
      Parameters<typeof nextPhase>[1],
      AssistantPhase,
    ][] = [
      ['idle', 'listen', 'listening'],
      ['idle', 'submit', 'thinking'],
      ['listening', 'submit', 'thinking'],
      ['listening', 'cancel', 'idle'],
      ['thinking', 'reply', 'answering'],
      ['thinking', 'cancel', 'idle'],
      ['answering', 'finish', 'idle'],
      ['answering', 'cancel', 'idle'],
    ]
    for (const [from, event, to] of steps)
      expect(nextPhase(from, event)).toBe(to)
  })

  it('表外的事件保持原阶段', () => {
    expect(nextPhase('idle', 'reply')).toBe('idle')
    expect(nextPhase('idle', 'cancel')).toBe('idle')
    expect(nextPhase('thinking', 'listen')).toBe('thinking')
    expect(nextPhase('answering', 'reply')).toBe('answering')
  })
})

describe('useAssistant：一次提问', () => {
  it('AI 未配置：不调模型，显示「去设置 AI」并回到待命', async () => {
    const deps = makeDeps({ aiReady: () => false })
    const a = useAssistant(deps)
    await a.ask('今晚看什么')
    expect(deps.classify).not.toHaveBeenCalled()
    expect(a.needsSetup.value).toBe(true)
    expect(a.answer.value).toContain('还没配置 AI')
    expect(a.phase.value).toBe('idle')
  })

  it('动作：思考中 → 执行 → 逐字显示回复 → 待命，结果卡片保留', async () => {
    vi.useFakeTimers()
    const gate = deferred<ParsedIntent>()
    const result = {
      kind: 'done',
      ok: true,
      icon: 'check',
      text: '已关闭弹幕',
    } as const
    const deps = makeDeps({
      classify: vi.fn(() => gate.promise),
      execute: vi.fn(async () => ({ message: '已关闭弹幕', result })),
      revealMs: () => 10,
    })
    const a = useAssistant(deps)
    const done = a.ask('关掉弹幕')
    expect(a.phase.value).toBe('thinking')
    expect(a.transcript.value).toBe('关掉弹幕')
    gate.resolve({ intent: { kind: 'continue' }, reply: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(a.phase.value).toBe('answering')
    expect(a.result.value).toEqual(result)
    await vi.advanceTimersByTimeAsync(20)
    expect(a.answer.value).toBe('已关')
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(a.answer.value).toBe('已关闭弹幕')
    expect(a.phase.value).toBe('idle')
    vi.useRealTimers()
  })

  it('只回答文字：流式增量逐段追加', async () => {
    const deps = makeDeps({
      classify: vi.fn(async () => ({
        intent: { kind: 'answer' as const },
        reply: '',
      })),
      stream: vi.fn(async (_t, _c, onDelta) => {
        onDelta('你')
        onDelta('好')
      }),
    })
    const a = useAssistant(deps)
    await a.ask('你好')
    expect(deps.execute).not.toHaveBeenCalled()
    expect(a.answer.value).toBe('你好')
    expect(a.phase.value).toBe('idle')
  })

  it('不在播放时的播放器命令：只给说明，不执行', async () => {
    const deps = makeDeps({
      classify: vi.fn(async () => ({
        intent: {
          kind: 'player' as const,
          command: { kind: 'rate' as const, value: 2 },
        },
        reply: '',
      })),
    })
    const a = useAssistant(deps)
    await a.ask('两倍速')
    expect(deps.execute).not.toHaveBeenCalled()
    expect(a.answer.value).toContain('没有正在播放')
  })

  it('要求收起的动作（跳转 / 设置）调用 close', async () => {
    const deps = makeDeps({
      execute: vi.fn(async () => ({ message: '', result: null, close: true })),
    })
    const a = useAssistant(deps)
    await a.ask('打开设置')
    expect(deps.close).toHaveBeenCalledOnce()
    expect(a.phase.value).toBe('idle')
  })

  it('私密拦截、超时等错误给出说明；not_configured 显示去设置', async () => {
    const deps = makeDeps({
      classify: vi.fn(async () => {
        throw new AiCallError('private_blocked', 'x')
      }),
    })
    const a = useAssistant(deps)
    await a.ask('推荐')
    expect(a.notice.value).toContain('本地模型')
    expect(a.phase.value).toBe('idle')

    deps.classify = vi.fn(async () => {
      throw new AiCallError('not_configured', 'x')
    })
    await a.ask('推荐')
    expect(a.needsSetup.value).toBe(true)
    expect(errorText(new AiCallError('cancelled', 'x'))).toBeNull()
  })
})

describe('useAssistant：取消', () => {
  it('取消后迟到的结果被丢弃，信号被 abort', async () => {
    const gate = deferred<ParsedIntent>()
    let signal: AbortSignal | null = null
    const deps = makeDeps({
      classify: vi.fn((_t, _c, s: AbortSignal) => {
        signal = s
        return gate.promise
      }),
    })
    const a = useAssistant(deps)
    const done = a.ask('推荐')
    a.cancel()
    expect(signal!.aborted).toBe(true)
    expect(a.phase.value).toBe('idle')
    gate.resolve({ intent: { kind: 'continue' }, reply: '' })
    await done
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('新提问取消上一轮，只有最新的结果生效', async () => {
    const first = deferred<ParsedIntent>()
    const calls: AbortSignal[] = []
    const deps = makeDeps({
      classify: vi.fn((text: string, _c, s: AbortSignal) => {
        calls.push(s)
        return text === 'A'
          ? first.promise
          : Promise.resolve({
              intent: { kind: 'continue' as const },
              reply: '',
            })
      }),
    })
    const a = useAssistant(deps)
    const one = a.ask('A')
    await a.ask('B')
    expect(calls[0].aborted).toBe(true)
    first.resolve({ intent: { kind: 'continue' }, reply: '' })
    await one
    expect(deps.execute).toHaveBeenCalledOnce()
    expect(a.transcript.value).toBe('B')
  })

  it('空白输入不提问', async () => {
    const deps = makeDeps()
    await useAssistant(deps).ask('   ')
    expect(deps.classify).not.toHaveBeenCalled()
  })
})

describe('useAssistant：语音', () => {
  let levelFn: ((level: number) => void) | null = null
  const session = {
    stop: vi.fn(async () => new Uint8Array([1])),
    cancel: vi.fn(),
  }

  beforeEach(() => {
    levelFn = null
    session.stop.mockClear()
    session.cancel.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('聆听中跟随音量，停止后转写并提问（私密标记传给转写）', async () => {
    const transcribe = vi.fn(async () => '今晚看什么')
    const deps = makeDeps({
      context: () => ({ ...context, private: true }),
      voice: {
        start: vi.fn(async onLevel => {
          levelFn = onLevel
          return session
        }),
        transcribe,
      },
    })
    const a = useAssistant(deps)
    await a.listen()
    expect(a.phase.value).toBe('listening')
    levelFn!(0.6)
    expect(a.level.value).toBe(0.6)
    await a.stopListening()
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), true)
    expect(deps.classify).toHaveBeenCalledWith(
      '今晚看什么',
      expect.anything(),
      expect.anything()
    )
    expect(a.level.value).toBe(0)
  })

  it('聆听中关闭：取消录音，不转写', async () => {
    const transcribe = vi.fn(async () => 'x')
    const deps = makeDeps({
      voice: { start: vi.fn(async () => session), transcribe },
    })
    const a = useAssistant(deps)
    await a.listen()
    a.cancel()
    expect(session.cancel).toHaveBeenCalledOnce()
    expect(a.phase.value).toBe('idle')
    await a.stopListening()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('没有语音依赖时 listen 什么也不做；麦克风打不开给出说明', async () => {
    const a = useAssistant(makeDeps())
    await a.listen()
    expect(a.phase.value).toBe('idle')
    const b = useAssistant(
      makeDeps({
        voice: {
          start: vi.fn(async () => {
            throw new Error('denied')
          }),
          transcribe: vi.fn(),
        },
      })
    )
    await b.listen()
    expect(b.notice.value).toContain('麦克风')
    expect(b.phase.value).toBe('idle')
  })
})
