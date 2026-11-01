import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

let tree: ReturnType<typeof tempTree>
beforeEach(() => {
  tree = tempTree()
})
afterEach(() => tree.cleanup())

async function settle(service: LibraryService): Promise<void> {
  for (let i = 0; i < 3; i++) await service.queue.idle()
}

describe('指纹任务的失败重试', () => {
  it('算不出指纹的文件记下失败时间，有新文件触发下一轮指纹任务时也不重试；其余文件照常算', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    tree.write('B (2002)/B (2002).mkv', Buffer.alloc(1024, 2))
    const fingerprint = vi.fn(async (path: string) =>
      path.includes('A (2001)') ? undefined : 'hash-b'
    )
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      fingerprint,
    })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await settle(service)

    const callsFor = (name: string): number =>
      fingerprint.mock.calls.filter(([p]) => p.includes(name)).length
    expect(callsFor('A (2001)')).toBe(1)
    expect(callsFor('B (2002)')).toBe(1)

    tree.write('C (2003)/C (2003).mkv', Buffer.alloc(1024, 3))
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    await settle(service)
    expect(callsFor('C (2003)')).toBe(1)
    expect(callsFor('A (2001)')).toBe(1)
    expect(callsFor('B (2002)')).toBe(1)
    await service.close()
  })

  it('文件内容变了就清掉失败记录，下一轮重新算', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    const fingerprint = vi.fn(async () => undefined)
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      fingerprint,
    })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await settle(service)
    expect(fingerprint).toHaveBeenCalledTimes(1)

    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(2048, 1))
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    await settle(service)
    expect(fingerprint).toHaveBeenCalledTimes(2)
    await service.close()
  })
})
