import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EffectScope, effectScope, nextTick, ref } from 'vue'
import type { RecapContext, RecapProbe } from '../src/shared/recap/types'
import { recapErrorText } from '../src/renderer/src/features/player/recap/recap-rules'
import { usePlotQa } from '../src/renderer/src/features/player/recap/use-plot-qa'
import { useRecap } from '../src/renderer/src/features/player/recap/use-recap'

/**
 * 播放器里的前情提要 / 问剧情：usePlotQa / useRecap 的状态机
 * （停止、换集、失败重试、缓存命中；recap-api 与 AI 全部 mock）。规则见 recap-rules.test.ts。
 */

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  probe: vi.fn(),
  save: vi.fn(),
  chatStream: vi.fn(),
  keySaved: true,
  settings: {} as Record<string, unknown>,
}))

vi.mock('../src/renderer/src/features/player/recap/recap-api', () => ({
  recapAvailable: () => true,
  prepareRecap: (...args: unknown[]) => mocks.prepare(...args),
  probeRecap: (...args: unknown[]) => mocks.probe(...args),
  saveRecap: (...args: unknown[]) => mocks.save(...args),
}))

vi.mock('@/features/ai', () => ({
  chatStream: (...args: unknown[]) => mocks.chatStream(...args),
  aiKeyConfigured: () => mocks.keySaved,
  // 与真实实现一致：从「[ai:<code>] 信息」里取回错误码
  toAiError: (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error)
    const match = /^\[ai:([a-z_]+)\]\s*(.*)$/.exec(text)
    return match
      ? { code: match[1], message: match[2] }
      : { code: 'network', message: text }
  },
}))

vi.mock('@/features/settings', async () => {
  const vue = await import('vue')
  return { useSetting: (key: string) => vue.ref(mocks.settings[key]) }
})

/** 手动控制结果的 Promise */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise(done => setTimeout(done, 0))

const context: RecapContext = {
  show: '漫长的季节',
  episode: { label: 'S01E02', episode: 2, season: 1 },
  previous: [
    {
      label: 'S01E01',
      episode: 1,
      season: 1,
      text: '第一集摘要',
      source: 'subtitle',
    },
  ],
  current: { seconds: 10, summaries: [], recent: '', hasSubtitle: false },
  cacheKey: 'recap:0123456789abcdef',
}

/** 假的流式对话：记下回调，结果由测试决定；中止时按真实实现抛 cancelled */
interface StreamCall {
  onDelta: (delta: string) => void
  signal: AbortSignal
  result: ReturnType<typeof deferred<{ content: string }>>
}
let streams: StreamCall[] = []

beforeEach(() => {
  streams = []
  mocks.prepare.mockReset()
  mocks.probe.mockReset()
  mocks.save.mockReset()
  mocks.keySaved = true
  mocks.settings = {
    'ai.recap.prompt': true,
    'ai.provider': 'deepseek',
    'ai.baseUrl': '',
    'ai.model': '',
  }
  mocks.chatStream.mockReset()
  mocks.chatStream.mockImplementation(
    (_request: unknown, options: Omit<StreamCall, 'result'>) => {
      const result = deferred<{ content: string }>()
      options.signal.addEventListener('abort', () =>
        result.reject(new Error('[ai:cancelled] 已取消'))
      )
      streams.push({ ...options, result })
      return result.promise
    }
  )
})

describe('usePlotQa', () => {
  let scope: EffectScope
  const source = ref('local://a.mkv')
  const setup = (): ReturnType<typeof usePlotQa> => {
    scope = effectScope()
    source.value = 'local://a.mkv'
    return scope.run(() =>
      usePlotQa({
        source: () => source.value,
        isPrivate: () => false,
        currentTime: () => 10,
      })
    )!
  }
  afterEach(() => scope.stop())

  /** 提问并等到请求发出；返回这次提问的完成 Promise（包一层，免得 async 把它摊平） */
  const askNow = async (
    qa: ReturnType<typeof usePlotQa>,
    question: string
  ): Promise<{ done: Promise<void> }> => {
    qa.input.value = question
    const done = qa.ask()
    await flush()
    return { done }
  }

  it('prepare 期间停止：busy 立刻归零、占位写「已停止」、prepare 被中止，之后还能再问', async () => {
    const pending = deferred<RecapContext>()
    mocks.prepare.mockReturnValueOnce(pending.promise)
    const qa = setup()
    const { done: first } = await askNow(qa, '他是谁？')
    expect(qa.busy.value).toBe(true)
    const signal = mocks.prepare.mock.calls[0][2] as AbortSignal

    qa.stop()
    expect(qa.busy.value).toBe(false)
    expect(signal.aborted).toBe(true)
    expect(qa.messages.value[1].text).toBe('已停止')
    expect(qa.announcement.value).toBe('已停止')

    // 迟到的 prepare 结果被丢弃，不发对话
    pending.resolve(context)
    await first
    expect(mocks.chatStream).not.toHaveBeenCalled()

    // 新问题不会被吞掉
    mocks.prepare.mockResolvedValueOnce(context)
    await askNow(qa, '为什么缺钱？')
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    expect(qa.busy.value).toBe(true)
    expect(qa.messages.value).toHaveLength(4)
  })

  it('流式中停止：之后的增量不再追加，busy 归零', async () => {
    mocks.prepare.mockResolvedValue(context)
    const qa = setup()
    const { done } = await askNow(qa, '他是谁？')
    const stream = streams[0]
    stream.onDelta('他是')
    expect(qa.messages.value[1].text).toBe('他是')

    qa.stop()
    expect(qa.busy.value).toBe(false)
    expect(stream.signal.aborted).toBe(true)
    stream.onDelta('王响')
    await done
    expect(qa.messages.value[1].text).toBe('他是')
    expect(qa.messages.value[1].error).toBeUndefined()
  })

  it('换集：清空会话，旧请求的增量不落到新会话', async () => {
    mocks.prepare.mockResolvedValue(context)
    const qa = setup()
    const { done } = await askNow(qa, '他是谁？')
    const old = streams[0]

    source.value = 'local://b.mkv'
    await nextTick()
    expect(qa.messages.value).toEqual([])
    expect(qa.busy.value).toBe(false)
    expect(old.signal.aborted).toBe(true)

    old.onDelta('旧回答')
    await done
    expect(qa.messages.value).toEqual([])

    await askNow(qa, '新问题')
    old.onDelta('旧回答')
    streams[1].onDelta('新回答')
    expect(qa.messages.value.map(m => m.text)).toEqual(['新问题', '新回答'])
  })

  it('prepare 抛错：写错误文案、busy 归零，可以重试且错误不进历史', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('[ai:timeout] 超时'))
    const qa = setup()
    const { done: failed } = await askNow(qa, '他是谁？')
    await failed
    expect(qa.busy.value).toBe(false)
    expect(qa.messages.value[1]).toMatchObject({
      error: true,
      text: recapErrorText({ code: 'timeout', message: '' }),
    })
    expect(qa.announcement.value).toBe('回答失败')

    mocks.prepare.mockResolvedValueOnce(context)
    const { done: retry } = await askNow(qa, '他是谁？')
    streams[0].result.resolve({ content: '王响' })
    await retry
    expect(qa.messages.value[3].text).toBe('王响')
    expect(qa.announcement.value).toBe('回答已生成')
    const request = mocks.chatStream.mock.calls[0][0] as {
      messages: { content: string }[]
    }
    const sent = request.messages.map(m => m.content).join('\n')
    expect(sent).not.toContain('超时')
  })
})

describe('useRecap', () => {
  let scope: EffectScope
  const probe: RecapProbe = {
    show: '漫长的季节',
    episode: { label: 'S01E02', episode: 2, season: 1 },
    previous: [{ label: 'S01E01', episode: 1, season: 1 }],
    cacheKey: 'recap:0123456789abcdef',
    cached: null,
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    })
  })
  afterEach(() => {
    scope.stop()
    vi.unstubAllGlobals()
  })

  const setup = async (
    found: RecapProbe = probe
  ): Promise<ReturnType<typeof useRecap>> => {
    mocks.probe.mockResolvedValue(found)
    scope = effectScope()
    const state = scope.run(() =>
      useRecap({
        source: () => 'local://a.mkv',
        isPrivate: () => false,
        startAt: () => 0,
      })
    )!
    await flush()
    return state
  }

  it('开播探测后浮出提示卡；AI 没配置时不弹', async () => {
    const recap = await setup()
    expect(recap.visible.value).toBe(true)
    scope.stop()
    mocks.keySaved = false
    const unconfigured = await setup()
    expect(unconfigured.available.value).toBe(true)
    expect(unconfigured.visible.value).toBe(false)
  })

  it('open()：有缓存直接展示，不调模型', async () => {
    const recap = await setup({ ...probe, cached: '缓存的要点' })
    recap.open()
    expect(recap.text.value).toBe('缓存的要点')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('open() 没缓存现生成并保存；regenerate() 重新生成', async () => {
    mocks.prepare.mockResolvedValue(context)
    const recap = await setup()
    recap.open()
    await flush()
    streams[0].onDelta('要')
    streams[0].result.resolve({ content: '要点' })
    await flush()
    expect(recap.text.value).toBe('要点')
    expect(recap.loading.value).toBe(false)
    expect(recap.announcement.value).toBe('前情提要已生成')
    expect(mocks.save).toHaveBeenCalledWith({
      cacheKey: context.cacheKey,
      text: '要点',
    })
    expect(recap.probe.value?.cached).toBe('要点')

    const again = recap.regenerate()
    await flush()
    streams[1].result.resolve({ content: '新要点' })
    await again
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    expect(recap.text.value).toBe('新要点')
  })

  it('失败写错误文案，regenerate() 成功后清掉错误', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('[ai:not_configured] x'))
    const recap = await setup()
    recap.open()
    await flush()
    expect(recap.error.value).toContain('设置 → AI')
    expect(recap.loading.value).toBe(false)

    mocks.prepare.mockResolvedValueOnce(context)
    const again = recap.regenerate()
    await flush()
    streams[0].result.resolve({ content: '要点' })
    await again
    expect(recap.error.value).toBe('')
    expect(recap.text.value).toBe('要点')
  })

  it('生成中关闭：loading 立刻归零、prepare 被中止，重新打开会再生成而不是卡住', async () => {
    const pending = deferred<RecapContext>()
    mocks.prepare.mockReturnValueOnce(pending.promise)
    const recap = await setup()
    recap.open()
    expect(recap.loading.value).toBe(true)
    recap.close()
    expect(recap.loading.value).toBe(false)
    expect((mocks.prepare.mock.calls[0][2] as AbortSignal).aborted).toBe(true)

    mocks.prepare.mockResolvedValueOnce(context)
    recap.show()
    expect(recap.loading.value).toBe(true)
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    pending.resolve(context)
    await flush()
    expect(streams).toHaveLength(1)
  })
})
