import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import { DownloadQueue } from '../src/engine/download/queue'

/**
 * 下载中途改了下载目录：任务记住第一次开始时的目录，失败重试、重启续下、移除清理
 * 都用这个目录，旧目录里的 .partial 不会被遗留，也不会在新目录从头再下一份。
 */
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'yb-taskdir-'))
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15))

describe('下载任务记住自己的目录', () => {
  it('失败后改了下载目录再重试：仍在原目录续下；改目录后新加的任务用新目录', async () => {
    let current = '/a'
    const runs: string[] = []
    let fail = true
    const queue = new DownloadQueue({
      file: join(await tmp(), 'queue.json'),
      downloadDir: async () => current,
      onChange: () => {},
      run: async (code, _report, _signal, dir) => {
        runs.push(`${code}@${dir}`)
        if (fail && code === 'OLD-1') throw new Error('断网')
        return { file: `${dir}/${code}`, site: 's' }
      },
    })
    queue.add('old-1')
    await settle()
    expect(queue.snapshot().failed.map(t => [t.id, t.dir])).toEqual([
      ['OLD-1', '/a'],
    ])

    current = '/b'
    fail = false
    queue.retry('old-1')
    queue.add('new-1')
    await settle()
    await settle()

    expect(runs).toEqual(['OLD-1@/a', 'OLD-1@/a', 'NEW-1@/b'])
  })

  it('重启后续下：用任务记下的目录，不用当前设置；老队列文件里没有目录的任务用当前目录', async () => {
    const file = join(await tmp(), 'queue.json')
    await writeFile(
      file,
      JSON.stringify({
        tasks: [
          { id: 'MID-1', status: 'active', dir: '/a', updatedAt: 1 },
          { id: 'LEGACY-1', status: 'queued', updatedAt: 1 },
        ],
      })
    )
    const runs: string[] = []
    const queue = new DownloadQueue({
      file,
      downloadDir: async () => '/b',
      onChange: () => {},
      run: async (code, _report, _signal, dir) => {
        runs.push(`${code}@${dir}`)
        return { file: code, site: 's' }
      },
    })
    await queue.load()
    await settle()
    await settle()
    expect(runs).toEqual(['MID-1@/a', 'LEGACY-1@/b'])
    await queue.flush()
    const saved = JSON.parse(await readFile(file, 'utf-8')) as {
      tasks: Array<{ id: string; dir?: string }>
    }
    expect(saved.tasks.map(t => [t.id, t.dir]).sort()).toEqual([
      ['LEGACY-1', '/b'],
      ['MID-1', '/a'],
    ])
  })

  it('移除任务：在任务自己的目录里清临时文件（进行中的等停下后）', async () => {
    let current = '/a'
    const discarded: string[] = []
    const queue = new DownloadQueue({
      file: join(await tmp(), 'queue.json'),
      downloadDir: async () => current,
      onChange: () => {},
      discard: async (code, dir) => void discarded.push(`${code}@${dir}`),
      run: (code, _r, signal) =>
        code === 'BAD-1'
          ? Promise.reject(new Error('x'))
          : new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('stop')))
            ),
    })
    queue.add('bad-1')
    await settle()
    queue.add('run-1')
    await settle()
    current = '/b'
    queue.remove('bad-1')
    queue.remove('run-1')
    await settle()
    expect(discarded).toEqual(['BAD-1@/a', 'RUN-1@/a'])
  })

  it('刚开始、还没定下目录就被移除：不调用 runner，不记失败，在定下的目录里清理', async () => {
    const runs: string[] = []
    const discarded: string[] = []
    const queue = new DownloadQueue({
      file: join(await tmp(), 'queue.json'),
      downloadDir: async () => '/a',
      onChange: () => {},
      discard: async (code, dir) => void discarded.push(`${code}@${dir}`),
      run: async code => {
        runs.push(code)
        return { file: code, site: 's' }
      },
    })
    queue.add('gone-1')
    queue.remove('gone-1')
    await settle()
    expect(runs).toEqual([])
    expect(discarded).toEqual(['GONE-1@/a'])
    expect(queue.snapshot()).toMatchObject({
      active: undefined,
      queued: [],
      failed: [],
      completed: [],
    })
  })
})

describe('下载域接线：改目录后重试续用旧目录的 .partial', () => {
  it('直链：在原目录按 Range 续下，新目录里不出现这个番号', async () => {
    const [a, b, state] = await Promise.all([tmp(), tmp(), tmp()])
    const body = 'MP4DATA'.repeat(100)
    const seen: Array<Record<string, string>> = []
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (url, init) => {
        if (url.startsWith('https://jable.tv/videos/mid-1/'))
          return new Response("var hlsUrl = 'https://cdn.test/v/mid.mp4';")
        if (url === 'https://cdn.test/v/mid.mp4') {
          const headers = init.headers as Record<string, string>
          seen.push(headers)
          const start = Number(headers.Range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0)
          return new Response(body.slice(start), {
            status: start ? 206 : 200,
            headers: start
              ? {
                  'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
                }
              : {},
          })
        }
        return new Response('nf', { status: 404 })
      },
    })
    // 上次在目录 a 下到 300 字节后失败
    await mkdir(join(a, 'MID-1'))
    await writeFile(join(a, 'MID-1', 'MID-1.mp4.partial'), body.slice(0, 300))
    await writeFile(
      join(a, 'MID-1', 'MID-1.mp4.partial.json'),
      JSON.stringify({
        v: 1,
        id: 'https://cdn.test/v/mid.mp4',
        total: body.length,
      })
    )
    const stateFile = join(state, 'queue.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        tasks: [
          { id: 'MID-1', status: 'failed', dir: a, updatedAt: Date.now() },
        ],
      })
    )
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const { queue } = createDownloadHandlers({
      net,
      stateFile,
      ctx: { emit: () => {}, busy: () => {}, host: (async () => b) as never },
    })
    await queue.load()

    queue.retry('mid-1')

    await vi.waitFor(() =>
      expect(queue.snapshot().completed.map(t => t.file)).toEqual([
        join(a, 'MID-1', 'MID-1.mp4'),
      ])
    )
    expect(seen.map(h => h.Range)).toEqual(['bytes=300-'])
    expect(await readFile(join(a, 'MID-1', 'MID-1.mp4'), 'utf-8')).toBe(body)
    expect(await readdir(join(a, 'MID-1'))).toEqual(['MID-1.mp4'])
    expect(await readdir(b)).toEqual([])
  })

  it('移除改目录前失败的任务：清的是它记下的目录，当前目录不动', async () => {
    const [a, b, state] = await Promise.all([tmp(), tmp(), tmp()])
    await mkdir(join(a, 'MID-1'))
    await writeFile(join(a, 'MID-1', 'MID-1.mp4.partial'), 'x')
    await writeFile(join(a, 'MID-1', 'MID-1.mp4.partial.json'), '{}')
    await mkdir(join(b, 'MID-1'))
    await writeFile(join(b, 'MID-1', 'MID-1.mp4.partial'), 'y')
    const stateFile = join(state, 'queue.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        tasks: [
          { id: 'MID-1', status: 'failed', dir: a, updatedAt: Date.now() },
        ],
      })
    )
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const { queue } = createDownloadHandlers({
      net: createNetClient({
        lookup: async () => [],
        fetch: async () => new Response('', { status: 404 }),
      }),
      stateFile,
      ctx: { emit: () => {}, busy: () => {}, host: (async () => b) as never },
    })
    await queue.load()

    queue.remove('mid-1')

    await vi.waitFor(async () => expect(await readdir(a)).toEqual([]))
    expect(await readdir(join(b, 'MID-1'))).toEqual(['MID-1.mp4.partial'])
  })
})
