vi.mock('@/features/section-lock', () => ({ isPathLocked: () => false }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { NlFilter } from '../../../src/renderer/src/features/library/nl-search/nl-filter'
import type {
  RecallBatch,
  SearchRequest,
} from '../../../src/renderer/src/features/library/search/types'
const { search, enhance } = vi.hoisted(() => ({
  search: vi.fn(),
  enhance: vi.fn(),
}))
vi.mock(
  '../../../src/renderer/src/features/library/search/search-service',
  () => ({ searchLibrary: search, searchAvailable: () => true })
)
vi.mock(
  '../../../src/renderer/src/features/library/search/ai-conditions',
  () => ({ enhanceConditions: enhance })
)
vi.mock('../../../src/renderer/src/features/library/api/bridge', () => ({
  errorText: (error: Error) => error.message,
}))
import { useUnifiedSearch } from '../../../src/renderer/src/features/library/search/use-unified-search'

const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
const scopes: ReturnType<typeof effectScope>[] = []

function session(): {
  text: ReturnType<typeof ref<string>>
  ai: ReturnType<typeof ref<boolean>>
  state: ReturnType<typeof useUnifiedSearch>
} {
  const text = ref('片名'),
    ai = ref(false),
    scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() =>
    useUnifiedSearch({
      text: () => text.value,
      scope: () => 'all',
      open: () => true,
      ai: () => ai.value,
    })
  )!
  return { text, ai, state }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  search.mockResolvedValue(undefined)
  enhance.mockResolvedValue({ genres: ['科幻'] })
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.useRealTimers()
})
describe('统一搜索会话', () => {
  it('输入不会自动调用 AI，即使开关已开启', async () => {
    const { ai, text } = session()
    ai.value = true
    text.value = '90 年代高分港片'
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalled()
    expect(enhance).not.toHaveBeenCalled()
  })
  it('新输入立刻取消上一轮，旧 AI 回复不能更新条件', async () => {
    let resolve!: (filter: NlFilter) => void
    enhance.mockImplementation(
      () =>
        new Promise<NlFilter>(done => {
          resolve = done
        })
    )
    const { ai, text, state } = session()
    ai.value = true
    await tick()
    const pending = state.run(true)
    await tick()
    const signal = enhance.mock.calls[0][2] as AbortSignal
    text.value = '另一个片名'
    expect(signal.aborted).toBe(true)
    resolve({ genres: ['恐怖'] })
    await pending
    expect(state.filter.value).toEqual({})
  })
  it('停止 AI 保留本地结果，不把停止状态显示为错误', async () => {
    search.mockImplementation(
      async (
        _request: SearchRequest,
        publish: (batch: RecallBatch) => void
      ) => {
        publish({ kind: 'title', candidates: [] })
      }
    )
    let reject!: (error: Error) => void
    enhance.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    const { ai, state } = session()
    ai.value = true
    await tick()
    const pending = state.run(true)
    await tick()
    state.stop()
    reject(new Error('cancelled'))
    await pending
    expect(state.thinking.value).toBe(false)
    expect(state.message.value).toBe('')
  })
  it('AI 条件不等待慢 CLIP 返回，且旧召回不能覆盖增强结果', async () => {
    let resolve!: () => void
    search.mockImplementationOnce(
      () =>
        new Promise<void>(done => {
          resolve = done
        })
    )
    const { state, ai } = session()
    // 先允许开关的响应式重新查询结算，再安排慢召回。
    ai.value = true
    await tick()
    search.mockImplementationOnce(() => new Promise<void>(() => {}))
    search.mockImplementationOnce(async () => {})
    await state.run(true)
    expect(state.filter.value.genres).toEqual(['科幻'])
    expect(enhance).toHaveBeenCalledOnce()
    resolve?.()
  })
})

it.each([false, true])(
  '本地查询拒绝时正常收尾，增强=%s，不泄漏未处理异常',
  async enabled => {
    const { state, ai } = session()
    ai.value = enabled
    await tick()
    search.mockRejectedValue(new Error('片库离线'))
    await state.run(enabled)
    expect(state.busy.value).toBe(false)
    expect(state.message.value).toContain('片库离线')
  }
)
it('输入尚未解析时切换 CLIP 范围仍保留规则条件', async () => {
  const text = ref('90 年代港片'),
    source = ref<'all' | 'video'>('all'),
    scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() =>
    useUnifiedSearch({
      text: () => text.value,
      scope: () => 'jav',
      open: () => true,
      ai: () => false,
      visualSource: () => source.value,
    })
  )!
  source.value = 'video'
  await tick()
  expect(state.filter.value.yearFrom).toBe(1990)
})
