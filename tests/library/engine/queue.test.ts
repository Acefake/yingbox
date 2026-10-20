import { describe, expect, it } from 'vitest'
import type { JobEvent } from '../../../src/shared/library/ipc'
import {
  type LibraryDb,
  openLibraryDb,
} from '../../../src/main/library/db/database'
import { JobStore } from '../../../src/main/library/jobs/job-store'
import {
  type JobHandler,
  JobQueue,
  PermanentJobError,
} from '../../../src/main/library/jobs/queue'

/** 可手动放行的任务：记录开始顺序，release 后结束。 */
function gate(): {
  handler: JobHandler
  started: unknown[]
  release: (value?: unknown) => void
  running: () => number
} {
  const started: unknown[] = []
  const waiters: Array<() => void> = []
  let active = 0
  return {
    started,
    running: () => active,
    handler: async (payload, ctx) => {
      started.push(payload)
      active++
      try {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve)
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))
        })
      } finally {
        active--
      }
    },
    release: () => waiters.shift()?.(),
  }
}

const tick = (ms = 0): Promise<void> => new Promise(r => setTimeout(r, ms))

function setup(options: { concurrency?: number; db?: LibraryDb } = {}): {
  db: LibraryDb
  store: JobStore
  queue: JobQueue
  events: JobEvent[]
} {
  const db = options.db ?? openLibraryDb(':memory:')
  const store = new JobStore(db)
  const events: JobEvent[] = []
  const queue = new JobQueue(store, {
    concurrency: options.concurrency ?? 1,
    backoff: () => 5,
    onEvent: e => events.push(e),
  })
  return { db, store, queue, events }
}

describe('JobQueue', () => {
  it('按优先级执行，同优先级先进先出', async () => {
    const { queue } = setup()
    const order: unknown[] = []
    queue.register('t', async p => {
      order.push(p)
    })
    queue.enqueue({ type: 't', payload: 'low-1', priority: 0 })
    queue.enqueue({ type: 't', payload: 'high', priority: 9 })
    queue.enqueue({ type: 't', payload: 'low-2', priority: 0 })
    queue.start()
    await tick(20)
    await queue.idle()
    expect(order).toEqual(['high', 'low-1', 'low-2'])
  })

  it('并发不超过上限', async () => {
    const { queue } = setup({ concurrency: 2 })
    const g = gate()
    queue.register('t', g.handler)
    queue.start()
    for (let i = 0; i < 5; i++) queue.enqueue({ type: 't', payload: i })
    await tick()
    expect(g.running()).toBe(2)
    for (let i = 0; i < 5; i++) {
      g.release()
      await tick()
      expect(g.running()).toBeLessThanOrEqual(2)
    }
    await queue.idle()
    expect(g.started).toHaveLength(5)
  })

  it('同 key：排队中合并载荷；运行中的不与同 key 任务并发', async () => {
    const { queue } = setup({ concurrency: 4 })
    const g = gate()
    queue.register('scan', g.handler, {
      merge: (a, b) => [...(a as string[]), ...(b as string[])],
    })
    queue.start()
    const first = queue.enqueue({ type: 'scan', key: 'lib:1', payload: ['a'] })
    await tick()
    const second = queue.enqueue({ type: 'scan', key: 'lib:1', payload: ['b'] })
    const merged = queue.enqueue({ type: 'scan', key: 'lib:1', payload: ['c'] })
    expect(merged.id).toBe(second.id)
    expect(merged.payload).toEqual(['b', 'c'])
    await tick()
    expect(g.running()).toBe(1) // 第二条要等第一条结束
    g.release()
    await tick()
    expect(g.started).toEqual([['a'], ['b', 'c']])
    expect(first.id).not.toBe(second.id)
    g.release()
    await queue.idle()
  })

  it('失败按退避重试，成功后结束', async () => {
    const { queue, store } = setup()
    let calls = 0
    queue.register('t', async () => {
      if (++calls < 3) throw new Error(`第 ${calls} 次失败`)
    })
    queue.start()
    const job = queue.enqueue({ type: 't', payload: null, maxAttempts: 3 })
    await tick(60)
    await queue.idle()
    expect(calls).toBe(3)
    expect(store.get(job.id)).toMatchObject({ state: 'done', attempts: 3 })
  })

  it('重试次数用完记为失败；PermanentJobError 不重试', async () => {
    const { queue, store, events } = setup()
    queue.register('flaky', async () => {
      throw new Error('总是失败')
    })
    queue.register('bad', async () => {
      throw new PermanentJobError('参数错误')
    })
    queue.start()
    const flaky = queue.enqueue({
      type: 'flaky',
      payload: null,
      maxAttempts: 2,
    })
    const bad = queue.enqueue({ type: 'bad', payload: null, maxAttempts: 5 })
    await tick(60)
    await queue.idle()
    expect(store.get(flaky.id)).toMatchObject({ state: 'failed', attempts: 2 })
    expect(store.get(bad.id)).toMatchObject({
      state: 'failed',
      attempts: 1,
      lastError: '参数错误',
    })
    expect(events.filter(e => e.state === 'failed')).toHaveLength(2)
  })

  it('取消：排队中的直接取消，运行中的收到中止信号', async () => {
    const { queue, store } = setup()
    const g = gate()
    queue.register('t', g.handler)
    queue.start()
    const running = queue.enqueue({ type: 't', payload: 1 })
    const queued = queue.enqueue({ type: 't', payload: 2 })
    await tick()
    expect(queue.cancel(queued.id)).toBe(true)
    expect(queue.cancel(running.id)).toBe(true)
    await queue.idle()
    expect(store.get(running.id)!.state).toBe('cancelled')
    expect(store.get(queued.id)!.state).toBe('cancelled')
    expect(g.started).toEqual([1])
  })

  it('引擎退出时运行中的任务保持运行态，重启后恢复执行（断点续跑）', async () => {
    const first = setup()
    const g = gate()
    first.queue.register('t', g.handler)
    first.queue.start()
    const job = first.queue.enqueue({ type: 't', payload: 'resume-me' })
    await tick()
    await first.queue.stop()
    expect(first.store.get(job.id)!.state).toBe('running')

    const second = setup({ db: first.db })
    const done: unknown[] = []
    second.queue.register('t', async p => {
      done.push(p)
    })
    second.queue.start()
    await tick()
    await second.queue.idle()
    expect(done).toEqual(['resume-me'])
    expect(second.store.get(job.id)).toMatchObject({
      state: 'done',
      attempts: 2,
    })
  })
})
