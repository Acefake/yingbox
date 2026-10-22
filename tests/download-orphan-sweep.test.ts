import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import {
  ORPHAN_TEMP_MAX_AGE_MS,
  sweepOrphanTemps,
} from '../src/engine/download/sweep'

/**
 * 孤儿临时文件：任务早就不在队列里（老版本移除时没清、改目录前留下、失败后再没管），
 * 它的 .partial 却一直占着盘。引擎启动读完队列后清扫一次。
 */
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'yb-sweep-'))
const DAY = 24 * 60 * 60 * 1000

/** 写文件并把修改时间设成 ageDays 天前。 */
async function put(path: string, ageDays: number, body = 'x'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
  const t = new Date(Date.now() - ageDays * DAY)
  await utimes(path, t, t)
}

const ls = (dir: string): Promise<string[]> => readdir(dir).then(n => n.sort())

describe('清扫孤儿续传临时文件', () => {
  it('7 天没动的才删；只删番号目录里 <番号>.*.partial 及其记录；目录空了一并删', async () => {
    const root = await tmp()
    await put(join(root, 'OLD-1', 'OLD-1.ts.partial'), 8)
    await put(join(root, 'OLD-1', 'OLD-1.ts.partial.segs'), 8)
    // 有成品：临时文件删、成品和目录留
    await put(join(root, 'OLD-2', 'OLD-2.mp4.partial'), 8)
    await put(join(root, 'OLD-2', 'OLD-2.mp4.partial.json'), 8)
    await put(join(root, 'OLD-2', 'OLD-2.mp4'), 8)
    // 最近还动过：留着
    await put(join(root, 'NEW-1', 'NEW-1.ts.partial'), 6)
    await put(join(root, 'NEW-1', 'NEW-1.ts.partial.segs'), 8)
    // 不是合法番号的目录（含小写、空格）：一律不碰
    await put(join(root, 'my videos', 'my videos.ts.partial'), 30)
    await put(join(root, 'abc-1', 'abc-1.ts.partial'), 30)
    // 番号目录里不是这个番号的、不是临时文件的：不碰
    await put(join(root, 'OTH-1', 'other.ts.partial'), 30)
    await put(join(root, 'OTH-1', 'OTH-1.ts.partial.bak'), 30)
    await put(join(root, 'OTH-1', 'OTH-1.txt'), 30)
    // 下载根目录下直接放的文件：不碰
    await put(join(root, 'ROOT-1.ts.partial'), 30)

    await sweepOrphanTemps([root], () => false)

    expect(await ls(root)).toEqual([
      'NEW-1',
      'OLD-2',
      'OTH-1',
      'ROOT-1.ts.partial',
      'abc-1',
      'my videos',
    ])
    expect(await ls(join(root, 'OLD-2'))).toEqual(['OLD-2.mp4'])
    expect(await ls(join(root, 'NEW-1'))).toEqual(['NEW-1.ts.partial'])
    expect(await ls(join(root, 'OTH-1'))).toEqual([
      'OTH-1.ts.partial.bak',
      'OTH-1.txt',
      'other.ts.partial',
    ])
    expect(await ls(join(root, 'abc-1'))).toEqual(['abc-1.ts.partial'])
    expect(await ls(join(root, 'my videos'))).toEqual(['my videos.ts.partial'])
  })

  it('等待 / 进行中的任务不碰；多个根目录都扫，重复和不存在的根目录不报错', async () => {
    const [a, b] = await Promise.all([tmp(), tmp()])
    await put(join(a, 'RUN-1', 'RUN-1.ts.partial'), 30)
    await put(join(a, 'GONE-1', 'GONE-1.ts.partial'), 30)
    await put(join(b, 'GONE-2', 'GONE-2.mp4.partial'), 30)
    const asked: string[] = []

    await sweepOrphanTemps([a, b, a, join(a, 'missing')], code => {
      asked.push(code)
      return code === 'RUN-1'
    })

    expect(await ls(a)).toEqual(['RUN-1'])
    expect(await ls(b)).toEqual([])
    expect(asked.sort()).toEqual(['GONE-1', 'GONE-2', 'RUN-1'])
  })

  it('期限按参数：now 与 maxAgeMs 可调，默认 7 天', async () => {
    expect(ORPHAN_TEMP_MAX_AGE_MS).toBe(7 * DAY)
    const root = await tmp()
    await put(join(root, 'A-1', 'A-1.ts.partial'), 2)
    await sweepOrphanTemps([root], () => false, { maxAgeMs: 3 * DAY })
    expect(await ls(root)).toEqual(['A-1'])
    await sweepOrphanTemps([root], () => false, {
      maxAgeMs: 3 * DAY,
      now: Date.now() + 2 * DAY,
    })
    expect(await ls(root)).toEqual([])
  })
})

describe('引擎启动时清扫（createDownloadHandlers().load）', () => {
  it('读完队列后扫当前下载目录和各任务记下的目录；等待中的任务保留，失败的和孤儿按期限删', async () => {
    const [a, b, c, state] = await Promise.all([tmp(), tmp(), tmp(), tmp()])
    // a：改目录前的旧下载目录
    await put(join(a, 'WAIT-1', 'WAIT-1.ts.partial'), 30)
    await put(join(a, 'WAIT-2', 'WAIT-2.ts.partial'), 30)
    await put(join(a, 'FAIL-1', 'FAIL-1.mp4.partial'), 30)
    await put(join(a, 'FAIL-1', 'FAIL-1.mp4.partial.json'), 30)
    await put(join(a, 'LOST-1', 'LOST-1.ts.partial'), 30)
    // b：当前下载目录
    await put(join(b, 'LOST-2', 'LOST-2.ts.partial'), 30)
    await put(join(b, 'LOST-2', 'LOST-2.ts.partial.segs'), 30)
    await put(join(b, 'FRESH-1', 'FRESH-1.ts.partial'), 1)
    // c：更早的目录，只有一个失败任务记着它
    await put(join(c, 'FAIL-2', 'FAIL-2.ts.partial'), 30)
    const stateFile = join(state, 'queue.json')
    const now = Date.now()
    await writeFile(
      stateFile,
      JSON.stringify({
        tasks: [
          { id: 'WAIT-1', status: 'queued', dir: a, updatedAt: now },
          { id: 'WAIT-2', status: 'queued', dir: a, updatedAt: now },
          { id: 'FAIL-1', status: 'failed', dir: a, updatedAt: now },
          { id: 'FAIL-2', status: 'failed', dir: c, updatedAt: now },
        ],
      })
    )
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const { load, queue } = createDownloadHandlers({
      // 解析页面一直不返回：WAIT-1 停在进行中
      net: createNetClient({
        lookup: async () => [{ address: '93.184.216.34' }],
        fetch: () => new Promise<Response>(() => {}),
      }),
      stateFile,
      ctx: { emit: () => {}, busy: () => {}, host: (async () => b) as never },
    })

    await load()

    expect(queue.snapshot().active?.id).toBe('WAIT-1')
    expect(queue.snapshot().queued.map(t => t.id)).toEqual(['WAIT-2'])
    expect(await ls(a)).toEqual(['WAIT-1', 'WAIT-2'])
    expect(await ls(join(a, 'WAIT-1'))).toEqual(['WAIT-1.ts.partial'])
    expect(await ls(b)).toEqual(['FRESH-1'])
    expect(await ls(c)).toEqual([])
    // 失败任务本身还在列表里，只是临时文件过期被清了
    expect(queue.snapshot().failed.map(t => t.id)).toEqual(['FAIL-1', 'FAIL-2'])
    expect(await readFile(stateFile, 'utf-8')).toContain('FAIL-1')
  })

  it('读不到当前下载目录时只扫任务记下的目录，不抛错', async () => {
    const [a, state] = await Promise.all([tmp(), tmp()])
    await put(join(a, 'FAIL-1', 'FAIL-1.ts.partial'), 30)
    const stateFile = join(state, 'queue.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        tasks: [{ id: 'FAIL-1', status: 'failed', dir: a, updatedAt: 1 }],
      })
    )
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const { load } = createDownloadHandlers({
      net: createNetClient({
        lookup: async () => [],
        fetch: async () => new Response('', { status: 404 }),
      }),
      stateFile,
      ctx: {
        emit: () => {},
        busy: () => {},
        host: (async () => {
          throw new Error('主进程不可用')
        }) as never,
      },
    })

    await expect(load()).resolves.toBeUndefined()
    expect(await ls(a)).toEqual([])
  })
})
