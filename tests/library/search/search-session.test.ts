vi.mock('@/features/section-lock', () => ({ isPathLocked: () => false }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
const { search, enhance } = vi.hoisted(() => ({
  search: vi.fn(),
  enhance: vi.fn(),
}))
vi.mock(
  '../../../src/renderer/src/features/library/search/ai-conditions',
  () => ({ enhanceConditions: enhance })
)
vi.mock(
  '../../../src/renderer/src/features/library/search/recall/conditions',
  () => ({
    recallConditions: async () => ({
      kind: 'conditions',
      candidates: [
        { item: { id: 2, title: '科幻片' }, reason: '符合筛选条件' },
      ],
    }),
  })
)
vi.mock(
  '../../../src/renderer/src/features/library/search/search-service',
  () => ({ searchLibrary: search, searchAvailable: () => true })
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

function session(
  initial = '片名',
  ai = false,
  area: 'all' | 'jav' = 'all'
): {
  text: ReturnType<typeof ref<string>>
  state: ReturnType<typeof useUnifiedSearch>
} {
  const text = ref(initial),
    scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() =>
    useUnifiedSearch({
      text: () => text.value,
      scope: () => area,
      open: () => true,
      ai: () => ai,
    })
  )!
  return { text, state }
}

const item = (id: number, title: string): Record<string, unknown> => ({
  id,
  libraryId: 1,
  type: 'movie',
  title,
  originalTitle: null,
  year: null,
  matchState: 'locked',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 0,
  updatedAt: 0,
})

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
  it('输入停 120ms 后只做本地召回，条件用规则解析', async () => {
    const { text, state } = session('')
    text.value = '90 年代高分港片'
    await vi.advanceTimersByTimeAsync(100)
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(search).toHaveBeenCalledOnce()
    expect(search.mock.calls[0][0].filter.yearFrom).toBe(1990)
    expect(state.filter.value.yearFrom).toBe(1990)
  })
  it('新输入立刻取消上一轮，迟到的结果不更新列表', async () => {
    let publish!: (batch: unknown) => void
    search.mockImplementationOnce(
      (_request: unknown, emit: (batch: unknown) => void) => {
        publish = emit
        return new Promise<void>(() => {})
      }
    )
    const { text, state } = session()
    await vi.advanceTimersByTimeAsync(150)
    const signal = search.mock.calls[0][0].signal as AbortSignal
    text.value = '另一个片名'
    expect(signal.aborted).toBe(true)
    publish({ kind: 'title', candidates: [] })
    expect(state.hits.value).toEqual([])
    expect(state.busy.value).toBe(false)
  })
  it('界面口令不触发召回', async () => {
    const { text } = session('')
    text.value = 'getav'
    await vi.advanceTimersByTimeAsync(150)
    expect(search).not.toHaveBeenCalled()
  })
})

it('本地查询拒绝时正常收尾，不泄漏未处理异常', async () => {
  const { state } = session()
  await tick()
  search.mockRejectedValue(new Error('片库离线'))
  await state.run()
  expect(state.busy.value).toBe(false)
  expect(state.message.value).toContain('片库离线')
})
it('切换 CLIP 范围立即按规则条件重新召回', async () => {
  const text = ref('90 年代港片'),
    source = ref<'all' | 'video'>('all'),
    scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() =>
    useUnifiedSearch({
      text: () => text.value,
      scope: () => 'jav',
      open: () => true,
      visualSource: () => source.value,
    })
  )!
  source.value = 'video'
  await tick()
  expect(state.filter.value.yearFrom).toBe(1990)
  expect(search.mock.lastCall?.[0].visualSource).toBe('video')
})

describe('AI 增强与本地融合', () => {
  it('AI 已配置且像自然语言：本地先出，停一会儿再解析，AI 召回与本地同作品合并去重、理由带「AI 理解」', async () => {
    search.mockImplementation(
      async (
        request: { filter: unknown },
        publish: (batch: unknown) => void,
        providers?: ((context: unknown) => Promise<unknown>)[]
      ) => {
        if (providers) {
          // AI 那一路：真实的 recallAi 包装（条件召回已替身）
          for (const provider of providers)
            publish(await provider({ ...request, base: {} }))
          return
        }
        publish({
          kind: 'title',
          candidates: [{ item: item(1, '本地片'), reason: '片名匹配' }],
        })
        publish({
          kind: 'conditions',
          candidates: [{ item: item(2, '科幻片'), reason: '符合筛选条件' }],
        })
      }
    )
    const { state } = session('找几部适合周末看的科幻片', true)
    await vi.advanceTimersByTimeAsync(150)
    expect(enhance).not.toHaveBeenCalled()
    expect(state.hits.value.map(hit => hit.item.id)).toEqual([2, 1])
    await vi.advanceTimersByTimeAsync(500)
    expect(enhance).toHaveBeenCalledOnce()
    expect(enhance.mock.calls[0][0]).toBe('找几部适合周末看的科幻片')
    const fused = state.hits.value
    expect(fused).toHaveLength(2)
    const scifi = fused.find(hit => hit.item.id === 2)!
    expect(scifi.reasons).toContain('符合筛选条件')
    expect(scifi.reasons.some(reason => reason.startsWith('AI 理解'))).toBe(
      true
    )
    expect(state.thinking.value).toBe(false)
  })
  it('片名式输入、AI 未配置、私密范围都不调模型', async () => {
    session('星际穿越', true)
    session('找几部适合周末看的科幻片', false)
    session('找几部适合周末看的科幻片', true, 'jav')
    await vi.advanceTimersByTimeAsync(1000)
    expect(search).toHaveBeenCalledTimes(3)
    expect(enhance).not.toHaveBeenCalled()
  })
  it('继续打字取消还没发出的 AI 请求；AI 失败只留本地结果', async () => {
    const { text, state } = session('找几部适合周末看的科幻片', true)
    await vi.advanceTimersByTimeAsync(300)
    text.value = '找几部适合周末看的科幻电影吧'
    await vi.advanceTimersByTimeAsync(300)
    expect(enhance).not.toHaveBeenCalled()
    enhance.mockRejectedValue(new Error('模型不可用'))
    await vi.advanceTimersByTimeAsync(400)
    expect(enhance).toHaveBeenCalledOnce()
    expect(state.message.value).toBe('')
    expect(state.thinking.value).toBe(false)
  })
})
