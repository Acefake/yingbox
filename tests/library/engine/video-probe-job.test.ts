import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LibraryService } from '../../../src/main/library/engine/service'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
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
  probeVideo: (path: string) => Promise<VideoProbe | null | 'unavailable'>,
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

  it('单个文件探测失败只记一次，不反复重试', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(1024, 1))
    const probe = vi.fn(async () => null)
    const service = await scanned(probe)
    expect(probe).toHaveBeenCalledTimes(1)
    const item = service.getItem({
      itemId: service.query(normalizeLibraryQuery({})).items[0].id,
    })!
    expect(item.files[0].video ?? null).toBeNull()
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
