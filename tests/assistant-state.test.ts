/**
 * AI 助手状态机：阶段转移表、一次提问的流转（动作 / 流式回答 / 门槛说明）、未配置 AI、对话上下文、
 * 取消与新提问丢弃迟到结果、模型错误提示、语音录入（音量 → 转写 → 提问）。依赖全部是替身。
 */
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { AiCallError } from '../src/renderer/src/features/ai'
import type { Router } from 'vue-router'

import type {
  AssistantIntent,
  ParsedIntent,
} from '../src/renderer/src/features/assistant/skills/skill-prompt'
import type {
  ActionOutcome,
  AssistantContext,
  SkillAction,
  SkillEnv,
} from '../src/renderer/src/features/assistant/skills/skill-types'
import {
  type AssistantDeps,
  type AssistantPhase,
  errorText,
  nextPhase,
  useAssistant,
} from '../src/renderer/src/features/assistant/use-assistant'

const context: AssistantContext = {
  route: { path: '/movie', title: '电影' },
  playing: false,
  controllable: false,
  plotQa: false,
  private: false,
  nowPlaying: null,
}

/** 动作执行转给当前 deps.execute（便于断言执行次数） */
const runner: {
  execute: (params: unknown, env: SkillEnv) => Promise<ActionOutcome>
} = { execute: async () => ({ message: '', result: null }) }

/** 一个替身动作的意图；gate 可模拟门槛 */
function act(gate?: SkillAction['gate']): AssistantIntent {
  return {
    kind: 'action',
    id: 'test.act',
    action: {
      name: 'act',
      describe: '',
      parse: () => true,
      gate,
      run: (params, env) => runner.execute(params, env),
    },
    params: true,
  }
}

type TestDeps = Omit<AssistantDeps, 'remember'> & {
  execute: Mock<(params: unknown, env: SkillEnv) => Promise<ActionOutcome>>
  remember: Mock<(user: string, reply: string, isPrivate: boolean) => void>
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

function makeDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const deps: TestDeps = {
    context: () => context,
    skills: () => [],
    aiReady: () => true,
    classify: vi.fn(
      async (): Promise<ParsedIntent> => ({
        intent: act(),
        reply: '好的',
      })
    ),
    stream: vi.fn(async () => {}),
    env: signal => ({
      router: {} as Router,
      openSettings: vi.fn(),
      signal,
    }),
    execute: vi.fn(
      async (): Promise<ActionOutcome> => ({
        message: '接着看',
        result: null,
      })
    ),
    remember: vi.fn(),
    close: vi.fn(),
    voice: null,
    revealMs: () => 0,
    ...overrides,
  }
  runner.execute = (params, env) => deps.execute(params, env)
  return deps
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
    gate.resolve({ intent: act(), reply: '' })
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
        intent: act(() => ({
          kind: 'explain',
          text: '现在没有正在播放的视频',
        })),
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
      classify: vi.fn((_t, _c, _k, s: AbortSignal) => {
        signal = s
        return gate.promise
      }),
    })
    const a = useAssistant(deps)
    const done = a.ask('推荐')
    a.cancel()
    expect(signal!.aborted).toBe(true)
    expect(a.phase.value).toBe('idle')
    gate.resolve({ intent: act(), reply: '' })
    await done
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('新提问取消上一轮，只有最新的结果生效', async () => {
    const first = deferred<ParsedIntent>()
    const calls: AbortSignal[] = []
    const deps = makeDeps({
      classify: vi.fn((text: string, _c, _k, s: AbortSignal) => {
        calls.push(s)
        return text === 'A'
          ? first.promise
          : Promise.resolve({
              intent: act(),
              reply: '',
            })
      }),
    })
    const a = useAssistant(deps)
    const one = a.ask('A')
    await a.ask('B')
    expect(calls[0].aborted).toBe(true)
    first.resolve({ intent: act(), reply: '' })
    await one
    expect(deps.execute).toHaveBeenCalledOnce()
    expect(a.transcript.value).toBe('B')
  })

  it('每轮问答记进对话上下文，带上是否私密', async () => {
    const deps = makeDeps({ context: () => ({ ...context, private: true }) })
    await useAssistant(deps).ask('继续')
    expect(deps.remember).toHaveBeenCalledWith('继续', '接着看', true)
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
      expect.anything(),
      expect.anything()
    )
    expect(a.level.value).toBe(0)
  })

  it('当前模式不允许语音（私密模式只允许本地识别）时不录音', async () => {
    const start = vi.fn(async () => session)
    const deps = makeDeps({
      voice: { start, transcribe: vi.fn() },
      voiceReady: () => false,
    })
    await useAssistant(deps).listen()
    expect(start).not.toHaveBeenCalled()
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
