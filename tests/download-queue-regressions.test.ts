import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DownloadQueue,
  type DownloadRunner,
} from '../src/engine/download/queue'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function setup(run: DownloadRunner): Promise<DownloadQueue> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'yb-queue-regression-'))
  return new DownloadQueue({
    file: join(dir, 'queue.json'),
    downloadDir: async () => dir,
    onChange: () => {},
    run,
  })
}

describe('下载队列回归', () => {
  it('移除后重新添加：忽略旧执行的进度和成功回调，新任务独立执行', async () => {
    const runs: Array<{
      report: Parameters<DownloadRunner>[1]
      resolve: (value: { file: string; site: string }) => void
    }> = []
    const queue = await setup(
      (_code, report) => new Promise(resolve => runs.push({ report, resolve }))
    )
    queue.add('A-1')
    await tick()
    queue.remove('A-1')
    queue.add('A-1')
    runs[0].report({ done: 99, total: 100, bytes: 99 })
    expect(queue.snapshot().queued[0].progress).toBeUndefined()
    runs[0].resolve({ file: 'old', site: 'old' })
    await tick()
    expect(runs).toHaveLength(2)
    expect(queue.snapshot().completed).toEqual([])
    expect(queue.snapshot().active?.id).toBe('A-1')
    runs[1].resolve({ file: 'new', site: 'new' })
    await tick()
    expect(queue.snapshot().completed[0].file).toBe('new')
    await queue.flush()
  })

  it('下载完成立即保存最终状态，并取消待保存的进度', async () => {
    let finish!: (value: { file: string; site: string }) => void
    let report!: Parameters<DownloadRunner>[1]
    const queue = await setup((_code, onProgress) => {
      report = onProgress
      return new Promise(resolve => {
        finish = resolve
      })
    })
    queue.add('A-1')
    await tick()
    await queue.flush()
    vi.mocked(fs.writeFile).mockClear()
    vi.useFakeTimers()
    report({ done: 1, bytes: 1 })
    finish({ file: 'complete', site: 's' })
    await tick()
    await queue.flush()
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const body = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(JSON.parse(body).tasks[0]).toMatchObject({
      status: 'done',
      file: 'complete',
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
  })

  it('密集进度合并写盘；定时保存及 flush 都保存最新进度', async () => {
    let report!: Parameters<DownloadRunner>[1]
    const queue = await setup((_code, onProgress) => {
      report = onProgress
      return new Promise(() => {})
    })
    queue.add('A-1')
    await tick()
    await queue.flush()
    vi.mocked(fs.writeFile).mockClear()
    vi.useFakeTimers()
    for (let i = 1; i <= 1000; i++) report({ done: i, bytes: i })
    expect(fs.writeFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    await queue.flush()
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    report({ done: 1001, bytes: 1001 })
    await queue.flush()
    expect(fs.writeFile).toHaveBeenCalledTimes(2)
    const body = vi.mocked(fs.writeFile).mock.calls.at(-1)![1] as string
    expect(JSON.parse(body).tasks[0].progress.bytes).toBe(1001)
  })
})
