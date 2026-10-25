import { describe, expect, it, vi } from 'vitest'

import {
  type AutograbDeps,
  type AutograbService,
  createAutograbService,
} from '../src/main/autograb/service'
import { searchStart } from '../src/main/autograb/schedule-rules'
import { Pan115Error } from '../src/main/pan115/errors'
import type { CalendarEpisode } from '../src/shared/library/ipc'

const GB = 1024 ** 3
const AIR = '2026-10-20'

function episode(n: number, fileId: number | null = null): CalendarEpisode {
  return {
    seriesId: 7,
    libraryId: 1,
    seriesTitle: '繁花',
    season: 1,
    episode: n,
    title: null,
    airDate: AIR,
    still: null,
    backdrop: null,
    itemId: null,
    fileId,
    filePath: null,
  }
}

interface Harness {
  service: AutograbService
  deps: AutograbDeps
  clock: { t: number }
  received: string[][]
  notified: string[]
  files: Map<string, string[]>
}

function setup(episodes: CalendarEpisode[], initial: unknown = null): Harness {
  const clock = { t: searchStart(AIR) + 60_000 }
  const files = new Map<string, string[]>()
  const received: string[][] = []
  const notified: string[] = []
  let saved: unknown = initial
  const deps: AutograbDeps = {
    calendar: async () => ({
      episodes,
      configured: true,
      series: 1,
      failed: 0,
    }),
    notify: async changes => void notified.push(...changes.map(c => c.path)),
    pan: {
      loggedIn: () => true,
      pansouReady: () => true,
      search: vi.fn(async () => [
        {
          title: '繁花 2160p 中字',
          source: 'x',
          url: 'https://115.com/s/abc?password=1234',
          shareCode: 'abc',
          receiveCode: '1234',
        },
      ]),
      snap: async () => ({
        title: '繁花',
        count: 2,
        files: [
          {
            id: '101',
            name: '繁花.第05集.2160p.WEB-DL.mkv',
            size: 2 * GB,
            isDir: false,
          },
          {
            id: '102',
            name: '繁花.第06集.2160p.WEB-DL.mkv',
            size: 2 * GB,
            isDir: false,
          },
        ],
      }),
      receive: async (_url, _pwd, ids, cid) => {
        received.push(ids)
        files.set(cid, [
          ...(files.get(cid) ?? []),
          ...ids.map(id =>
            id === '101' ? '繁花.第05集.2160p.WEB-DL.mkv' : id
          ),
        ])
      },
      names: async cid => files.get(cid) ?? [],
      dirPath: async () => ['剧集', '繁花'],
    },
    defaultCid: () => '0',
    load: async () => saved,
    save: async state => void (saved = JSON.parse(JSON.stringify(state))),
    now: () => clock.t,
    sleep: async ms => void (clock.t += ms),
    emit: () => {},
    log: () => {},
  }
  return {
    service: createAutograbService(deps),
    deps,
    clock,
    received,
    notified,
    files,
  }
}

describe('追更服务', () => {
  it('不追的剧不搜', async () => {
    const { service, deps } = setup([episode(5)])
    await service.tick()
    expect(deps.pan.search).not.toHaveBeenCalled()
  })

  it('待确认：搜到候选，点转存只存那一集，重复点不重复存', async () => {
    const { service, received } = setup([episode(5)])
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    const overview = await service.overview()
    const record = overview.episodes.find(e => e.key === '7:1:5')!
    expect(record.status).toBe('found')
    expect(record.candidates[0].fileId).toBe('101')
    expect(received).toEqual([])
    expect(await service.grab('7:1:5', 0)).toEqual({ ok: true })
    expect(await service.grab('7:1:5', 0)).toEqual({ ok: true })
    expect(received).toEqual([['101']])
    const after = await service.overview()
    expect(after.series.find(s => s.seriesId === 7)!.confirmed).toBe(1)
  })

  it('全自动：没设文件夹不让开；确认不满 3 集不自动存', async () => {
    const { service, received } = setup([episode(5)])
    expect((await service.setSeries(7, { mode: 'auto' })).ok).toBe(false)
    await service.setSeries(7, { mode: 'auto', cid: '55', cidName: '繁花' })
    await service.tick()
    expect(received).toEqual([])
  })

  it('全自动：确认满 3 集后分数过线直接存到这部剧的文件夹', async () => {
    const initial = {
      version: 1,
      series: {
        '7': {
          title: '繁花',
          mode: 'auto',
          cid: '55',
          cidName: '繁花',
          confirmed: 3,
        },
      },
    }
    const { service, received, files } = setup([episode(5)], initial)
    await service.tick()
    expect(received).toEqual([['101']])
    expect(files.get('55')).toEqual(['繁花.第05集.2160p.WEB-DL.mkv'])
    const record = (await service.overview()).episodes.find(
      e => e.key === '7:1:5'
    )!
    expect(record.status).toBe('saved')
  })

  it('本地已有这一集就标记已入库', async () => {
    const eps = [episode(5)]
    const { service } = setup(eps)
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    eps[0] = episode(5, 99)
    await service.tick()
    const overview = await service.overview()
    expect(overview.episodes.find(e => e.key === '7:1:5')!.status).toBe('done')
  })

  it('转存后 10 分钟没入库，按 115 路径通知媒体库', async () => {
    const { service, clock, notified } = setup([episode(5)])
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    await service.grab('7:1:5', 0)
    clock.t += 11 * 60_000
    await service.tick()
    expect(notified).toEqual(['/剧集/繁花/繁花.第05集.2160p.WEB-DL.mkv'])
  })

  it('分享失效：拉黑并回到等待', async () => {
    const { service, deps } = setup([episode(5)])
    deps.pan.receive = async () => {
      throw new Pan115Error('分享已过期', 4100018)
    }
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    const result = await service.grab('7:1:5', 0)
    expect(result.ok).toBe(false)
    const record = (await service.overview()).episodes.find(
      e => e.key === '7:1:5'
    )!
    expect(record.status).toBe('waiting')
    expect(record.candidates).toEqual([])
  })
})
