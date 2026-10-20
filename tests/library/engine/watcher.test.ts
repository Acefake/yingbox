import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LibraryEvent,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { KeyedBatcher } from '../../../src/main/library/scanner/batcher'
import { dirsForChanges } from '../../../src/main/library/scanner/watcher'
import {
  LibraryService,
  mergeScanPayload,
} from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

describe('KeyedBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('静默期后整批交出，同键去重', () => {
    vi.useFakeTimers()
    const batches: string[][] = []
    const b = new KeyedBatcher<string>(items => batches.push(items), {
      quietMs: 100,
    })
    b.push('a', 'A1')
    vi.advanceTimersByTime(50)
    b.push('a', 'A2')
    b.push('b', 'B')
    vi.advanceTimersByTime(99)
    expect(batches).toEqual([])
    vi.advanceTimersByTime(1)
    expect(batches).toEqual([['A2', 'B']])
  })

  it('事件持续不断时最长 maxWaitMs 交一次', () => {
    vi.useFakeTimers()
    const batches: string[][] = []
    const b = new KeyedBatcher<string>(items => batches.push(items), {
      quietMs: 100,
      maxWaitMs: 300,
    })
    for (let t = 0; t < 350; t += 50) {
      b.push(String(t), String(t))
      vi.advanceTimersByTime(50)
    }
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual(['0', '50', '100', '150', '200', '250'])
  })
})

describe('dirsForChanges', () => {
  it('取父目录去重；忽略隐藏 / NAS 缩略图目录；rename 不看扩展名（可能是删掉的目录）', () => {
    const dirs = dirsForChanges([
      { type: 'rename', path: '/lib/Show/Season 1/E01.mkv' },
      { type: 'change', path: '/lib/Show/Season 1/E02.mkv' },
      { type: 'change', path: '/lib/Show/Season 1/E03.mkv.part' },
      { type: 'rename', path: '/lib/Show/.DS_Store' },
      { type: 'rename', path: '/lib/Show/@eaDir/E01.mkv/SYNOPHOTO.jpg' },
      { type: 'rename', path: '/lib/Old.Movie.2019.1080p' },
    ])
    expect([...dirs.values()].sort()).toEqual(['/lib', '/lib/Show/Season 1'])
  })
})

describe('mergeScanPayload', () => {
  it('任何一方是整库扫描结果就是整库扫描；否则目录取并集', () => {
    expect(
      mergeScanPayload({ libraryId: 1, dirs: ['/a'] }, { libraryId: 1 })
    ).toEqual({
      libraryId: 1,
      full: false,
    })
    expect(
      mergeScanPayload(
        { libraryId: 1, dirs: ['/a'] },
        { libraryId: 1, dirs: ['/b', '/a'] }
      )
    ).toEqual({ libraryId: 1, full: false, dirs: ['/a', '/b'] })
  })
})

describe('LibraryService + fs.watch（端到端）', () => {
  it('新增文件触发增量扫描并推送 items-changed', async () => {
    const tree = tempTree()
    tree.write('A (2001)/A (2001).mkv')
    const service = new LibraryService({ dbPath: ':memory:', watchQuietMs: 50 })
    try {
      await service.start()
      await service.addLibrary({ root: tree.root, kind: 'movie' })
      await service.queue.idle()

      const changed = new Promise<LibraryEvent>(resolve =>
        service.subscribe(e => {
          if (e.type === 'items-changed') resolve(e)
        })
      )
      tree.write('B (2002)/B (2002).mkv')
      const event = await Promise.race([
        changed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('5 秒内没有收到变化事件')), 5000)
        ),
      ])
      await service.queue.idle()

      expect(event).toMatchObject({
        type: 'items-changed',
        added: [expect.any(Number)],
      })
      const titles = service
        .query(normalizeLibraryQuery({}))
        .items.map(i => i.title)
      expect(titles).toEqual(['A', 'B'])
    } finally {
      await service.close()
      tree.cleanup()
    }
  }, 10_000)
})
