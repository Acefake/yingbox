import { expect, it } from 'vitest'
import { KeyedMutex } from '../../../src/main/library/jobs/keyed-mutex'

it('等待媒体库锁的任务取消后退出，不影响之后的任务', async () => {
  const lock = new KeyedMutex<number>()
  let release!: () => void
  const first = lock.run(
    1,
    () =>
      new Promise<void>(resolve => {
        release = resolve
      })
  )
  await Promise.resolve()
  const controller = new AbortController()
  let ran = false
  const cancelled = lock.run(
    1,
    async () => {
      ran = true
    },
    controller.signal
  )
  const next = lock.run(1, async () => '完成')
  controller.abort(new Error('取消'))
  await expect(cancelled).rejects.toThrow('取消')
  expect(ran).toBe(false)
  release()
  await first
  await expect(next).resolves.toBe('完成')
})
