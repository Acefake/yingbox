import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type LibraryJobDeps,
  runProbe,
} from '../../../src/main/library/engine/library-jobs'
import { LibraryService } from '../../../src/main/library/engine/service'
import { KeyedMutex } from '../../../src/main/library/jobs/keyed-mutex'
import type { JobContext } from '../../../src/main/library/jobs/queue'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import type { VideoProbeOutcome } from '../../../src/main/library/scanner/video-probe'
import type { VideoProbe } from '../../../src/shared/video-range'
import { tempTree } from './helpers'

let tree: ReturnType<typeof tempTree>
beforeEach(() => {
  tree = tempTree()
})
afterEach(() => tree.cleanup())

const P5: VideoProbe = { range: 'dv', dvProfile: 5, dvCompat: 0 }
const HDR10: VideoProbe = { range: 'hdr10', dvProfile: null, dvCompat: null }

/** 起一个服务，加库并等后台任务（扫描 → 指纹 / 探测）都跑完。 */
async function scanned(
  probeVideo: (path: string) => Promise<VideoProbeOutcome>,
  kind: 'movie' | 'tv' = 'movie'
): Promise<LibraryService> {
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    probeVideo,
  })
  await service.start()
  await service.addLibrary({ root: tree.root, kind })
  for (let i = 0; i < 3; i++) await service.queue.idle()
  return service
}

describe('媒体库视频动态范围探测', () => {
  it('扫描后探测视频流，结果写进文件元数据与列表摘要', async () => {
    tree.write('Dune (2021)/Dune (2021).mkv', Buffer.alloc(2048, 1))
    tree.write('Dune (2021)/poster.jpg', 'img')
    const probe = vi.fn(async () => P5)
    const service = await scanned(probe)

    expect(probe).toHaveBeenCalledTimes(1) // 只探测视频，不探测图片
    const [summary] = service.query(normalizeLibraryQuery({})).items
    expect(summary.videoRange).toBe('dv')
    const item = service.getItem({ itemId: summary.id })!
    const video = item.files.find(f => f.kind === 'video')!
    expect(video.video).toEqual(P5)
    await service.close()
  })

  it('剧集：摘要取全部集里最好的一档', async () => {
    tree.write('Show/Season 01/Show S01E01.mkv', Buffer.alloc(1024, 1))
    tree.write('Show/Season 01/Show S01E02.mkv', Buffer.alloc(1024, 2))
    const service = await scanned(
      async path => (path.includes('E02') ? HDR10 : { ...HDR10, range: 'sdr' }),
      'tv'
    )
    const [summary] = service.query(normalizeLibraryQuery({})).items
    expect(summary.videoRange).toBe('hdr10')
    await service.close()
  })

  it('没有 ffprobe：不写结果、不报错，探测只试一次', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    tree.write('B (2002)/B (2002).mkv', Buffer.alloc(1024, 2))
    const probe = vi.fn(async () => 'unavailable' as const)
    const service = await scanned(probe)
    expect(probe).toHaveBeenCalledTimes(1)
    const rows = service.db
      .prepare(`SELECT video_range FROM files WHERE kind = 'video'`)
      .all()
    expect(rows.map(r => r.video_range)).toEqual([null, null])
    const [summary] = service.query(normalizeLibraryQuery({})).items
    expect(summary.videoRange ?? null).toBeNull()
    await service.close()
  })

  it('宿主不提供探测能力时什么都不做', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    const service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    const item = service.getItem({
      itemId: service.query(normalizeLibraryQuery({})).items[0].id,
    })!
    expect(item.files[0].video ?? null).toBeNull()
    await service.close()
  })

  it("读不出视频流（null）记 ''，之后不再探测", async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    const probe = vi.fn(async () => null)
    const service = await scanned(probe)
    expect(probe).toHaveBeenCalledTimes(1)
    const rows = service.db
      .prepare(`SELECT video_range FROM files WHERE kind = 'video'`)
      .all()
    expect(rows.map(r => r.video_range)).toEqual([''])
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    expect(probe).toHaveBeenCalledTimes(1)
    const item = service.getItem({
      itemId: service.query(normalizeLibraryQuery({})).items[0].id,
    })!
    expect(item.files[0].video ?? null).toBeNull()
    await service.close()
  })

  it('瞬时失败（failed）保持未探测：本轮只试一次，下次扫描再试并写入', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    tree.write('B (2002)/B (2002).mkv', Buffer.alloc(1024, 2))
    let answer: VideoProbeOutcome = 'failed'
    const probe = vi.fn(async () => answer)
    const service = await scanned(probe)
    expect(probe).toHaveBeenCalledTimes(2)
    const ranges = (): unknown[] =>
      service.db
        .prepare(`SELECT video_range FROM files WHERE kind = 'video'`)
        .all()
        .map(r => r.video_range)
    expect(ranges()).toEqual([null, null])
    answer = HDR10
    // 文件没变的重扫也会补探测
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    expect(probe).toHaveBeenCalledTimes(4)
    expect(ranges()).toEqual(['hdr10', 'hdr10'])
    await service.close()
  })

  it('装上 ffmpeg 后重扫（文件没变）补探测', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    let answer: VideoProbeOutcome = 'unavailable'
    const probe = vi.fn(async () => answer)
    const service = await scanned(probe)
    expect(probe).toHaveBeenCalledTimes(1)
    answer = P5
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    expect(probe).toHaveBeenCalledTimes(2)
    const item = service.getItem({
      itemId: service.query(normalizeLibraryQuery({})).items[0].id,
    })!
    expect(item.files[0].video).toEqual(P5)
    await service.close()
  })

  it('文件内容变了：动态范围三列（video_range / dv_profile / dv_compat）一起清空', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    let answer: VideoProbeOutcome = P5
    const service = await scanned(async () => answer)
    answer = 'failed'
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(4096, 3))
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    const row = service.db
      .prepare(
        `SELECT video_range, dv_profile, dv_compat FROM files WHERE kind = 'video'`
      )
      .get() as Record<string, unknown>
    expect(row).toEqual({
      video_range: null,
      dv_profile: null,
      dv_compat: null,
    })
    await service.close()
  })

  it('文件内容变了重新探测', async () => {
    const path = tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    let answer: VideoProbe = HDR10
    const probe = vi.fn(async () => answer)
    const service = await scanned(probe)
    answer = P5
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(4096, 3))
    service.scan({ libraryId: service.listLibraries()[0].id, full: true })
    for (let i = 0; i < 3; i++) await service.queue.idle()
    expect(probe).toHaveBeenCalledTimes(2)
    const item = service.getItem({
      itemId: service.query(normalizeLibraryQuery({})).items[0].id,
    })!
    expect(item.files.find(f => f.path === path)?.video).toEqual(P5)
    await service.close()
  })
})

describe('探测任务与库锁', () => {
  it('整理 / 扫描拿着同库的锁时，探测等锁放开再读文件', async () => {
    const locks = new KeyedMutex<number>()
    let release = (): void => {}
    const held = locks.run(
      7,
      () => new Promise<void>(resolve => (release = resolve))
    )
    const probe = vi.fn(async () => HDR10)
    const written: number[] = []
    const deps = {
      db: { exec: () => {} },
      probeVideo: probe,
      libraryFor: () => ({ id: 7 }),
      scanStore: {
        unprobed: (_lib: number, afterId: number) =>
          afterId ? [] : [{ id: 1, displayPath: '/m/a.mkv' }],
        setVideoProbe: (id: number) => void written.push(id),
      },
    } as unknown as LibraryJobDeps
    const running = runProbe(
      deps,
      { libraryId: 7 },
      { signal: new AbortController().signal } as JobContext,
      locks
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(probe).not.toHaveBeenCalled()
    release()
    await held
    await running
    expect(probe).toHaveBeenCalledTimes(1)
    expect(written).toEqual([1])
  })
})
