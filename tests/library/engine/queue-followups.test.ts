/**
 * 任务定义里的声明式后继（followups）：父任务结束后由队列统一派发——
 * 成功派；失败看定义（when: 'settled' 在最终失败时也派，重试中不派）；取消 / 引擎退出不派；
 * 按 key（任务类型 + 目标）去重：同 key 已排队就合并进那一条；异步算出的后继在 idle() 前落库。
 */
import { describe, expect, it } from 'vitest'
import { openLibraryDb } from '../../../src/main/library/db/database'
import { JobStore } from '../../../src/main/library/jobs/job-store'
import { JobQueue } from '../../../src/main/library/jobs/queue'

const tick = (ms = 0): Promise<void> => new Promise(r => setTimeout(r, ms))

function setup(concurrency = 2): {
  queue: JobQueue
  store: JobStore
  ran: Array<[string, unknown]>
  logs: string[]
} {
  const db = openLibraryDb(':memory:')
  const store = new JobStore(db)
  const logs: string[] = []
  const queue = new JobQueue(store, {
    concurrency,
    backoff: () => 5,
    log: m => logs.push(m),
  })
  const ran: Array<[string, unknown]> = []
  queue.register(
    'child',
    async p => {
      ran.push(['child', p])
    },
    { merge: (a, b) => [...(a as number[]), ...(b as number[])] }
  )
  return { queue, store, ran, logs }
}

/** 一条 child 后继。 */
const child = (ids: number[], key = 'child:1') => ({
  type: 'child',
  key,
  payload: ids,
})

const rows = (store: JobStore, n = 50) =>
  Array.from({ length: n }, (_, i) => store.get(i + 1)).filter(
    (j): j is NonNullable<typeof j> => !!j
  )

describe('声明式后继', () => {
  it('成功后按定义派发，后继拿到父任务的结果与载荷', async () => {
    const { queue, ran } = setup()
    queue.register('parent', async p => ({ found: (p as number) * 2 }), {
      followups: {
        next: ({ payload, result }) => [
          child([payload as number, (result as { found: number }).found]),
        ],
      },
    })
    queue.start()
    queue.enqueue({ type: 'parent', payload: 3 })
    await queue.idle()
    expect(ran).toEqual([['child', [3, 6]]])
  })

  it('异步算出的后继在 idle() 之前已入队并跑完', async () => {
    const { queue, ran } = setup()
    queue.register('parent', async () => undefined, {
      followups: {
        next: async () => {
          await tick(10)
          return [child([1])]
        },
      },
    })
    queue.start()
    queue.enqueue({ type: 'parent', payload: null })
    await queue.idle()
    expect(ran).toEqual([['child', [1]]])
  })

  it('默认只在成功后派发：最终失败不派', async () => {
    const { queue, store, ran } = setup()
    queue.register(
      'parent',
      async () => {
        throw new Error('坏了')
      },
      { followups: { next: () => [child([1])] } }
    )
    queue.start()
    queue.enqueue({ type: 'parent', payload: null, maxAttempts: 2 })
    await tick(50)
    await queue.idle()
    expect(rows(store).map(j => [j.type, j.state])).toEqual([
      ['parent', 'failed'],
    ])
    expect(ran).toEqual([])
  })

  it("when: 'settled'：最终失败也派，且只派一次（重试中不派）", async () => {
    const { queue, store, ran } = setup()
    let calls = 0
    queue.register(
      'parent',
      async () => {
        calls++
        throw new Error('坏了')
      },
      { followups: { when: 'settled', next: () => [child([7])] } }
    )
    queue.start()
    queue.enqueue({ type: 'parent', payload: null, maxAttempts: 3 })
    for (let i = 0; i < 10 && calls < 3; i++) await tick(20)
    await tick(20)
    await queue.idle()
    expect(calls).toBe(3)
    expect(rows(store).filter(j => j.type === 'child')).toHaveLength(1)
    expect(ran).toEqual([['child', [7]]])
  })

  it('父任务被取消不派发：抛出中止和吞掉中止正常返回都一样', async () => {
    const { queue, store, ran } = setup()
    for (const type of ['throws', 'swallows']) {
      queue.register(
        type,
        (_p, ctx) =>
          new Promise<void>((resolve, reject) => {
            ctx.signal.addEventListener('abort', () =>
              type === 'throws' ? reject(ctx.signal.reason) : resolve()
            )
          }),
        { followups: { when: 'settled', next: () => [child([1])] } }
      )
    }
    queue.start()
    const a = queue.enqueue({ type: 'throws', payload: null })
    const b = queue.enqueue({ type: 'swallows', payload: null })
    await tick()
    queue.cancel(a.id)
    queue.cancel(b.id)
    await queue.idle()
    expect(ran).toEqual([])
    expect(rows(store).filter(j => j.type === 'child')).toEqual([])
  })

  it('引擎退出时运行中的父任务不派发', async () => {
    const { queue, store } = setup()
    queue.register(
      'parent',
      (_p, ctx) =>
        new Promise<void>(resolve =>
          ctx.signal.addEventListener('abort', () => resolve())
        ),
      { followups: { when: 'settled', next: () => [child([1])] } }
    )
    queue.start()
    queue.enqueue({ type: 'parent', payload: null })
    await tick()
    await queue.stop()
    expect(rows(store).filter(j => j.type === 'child')).toEqual([])
  })

  it('按 key 去重：同 key 已排队就合并进那一条，不新建', async () => {
    // 并发 1：父任务按 id 依次跑完，child 排在它们后面
    const { queue, store, ran } = setup(1)
    queue.register('parent', async p => p, {
      followups: { next: ({ result }) => [child(result as number[])] },
    })
    // 先不启动：两个父任务都结束前 child 一直排着
    queue.enqueue({ type: 'parent', payload: [1] })
    queue.enqueue({ type: 'parent', payload: [2] })
    queue.dispatch([child([3]), child([4], 'child:other')])
    queue.start()
    await tick(20)
    await queue.idle()
    const children = rows(store).filter(j => j.type === 'child')
    expect(children).toHaveLength(2)
    expect(ran).toContainEqual(['child', [3, 1, 2]])
    expect(ran).toContainEqual(['child', [4]])
  })

  it('同 key 进行中：最多再排一条（进行中的任务开工时已取定目标），之后的合并进它', async () => {
    const { queue, store } = setup()
    let release: () => void = () => {}
    queue.register(
      'slow',
      () => new Promise<void>(resolve => (release = resolve))
    )
    queue.start()
    queue.enqueue({ type: 'slow', key: 'slow:1', payload: 1 })
    await tick()
    queue.dispatch([{ type: 'slow', key: 'slow:1', payload: 2 }])
    queue.dispatch([{ type: 'slow', key: 'slow:1', payload: 3 }])
    const slow = rows(store).filter(j => j.type === 'slow')
    expect(slow.map(j => j.state)).toEqual(['running', 'queued'])
    expect(slow[1].payload).toBe(3)
    release()
    await tick()
    release()
    await queue.idle()
  })

  it('算后继出错只记日志：父任务照样完成，不影响队列', async () => {
    const { queue, store, logs, ran } = setup()
    queue.register('parent', async () => undefined, {
      followups: {
        next: () => {
          throw new Error('查不到库')
        },
      },
    })
    queue.start()
    queue.enqueue({ type: 'parent', payload: null })
    await queue.idle()
    queue.enqueue({ type: 'child', payload: [9] })
    await queue.idle()
    expect(rows(store)[0].state).toBe('done')
    expect(logs.join('\n')).toMatch(/parent.*查不到库/)
    expect(ran).toEqual([['child', [9]]])
  })
})
