import { describe, expect, it, vi } from 'vitest'

import { createGate, emptyGate } from '../src/main/autograb/gate'
import {
  type MoviesDeps,
  type MoviesService,
  createMoviesService,
} from '../src/main/autograb/movies/service'
import type { MovieInfo } from '../src/main/autograb/movies/tmdb'
import { searchStart } from '../src/main/autograb/schedule-rules'
import type { TrackedMovie } from '../src/shared/contract/autograb-upgrade'

const GB = 1024 ** 3
const DAY = 24 * 3_600_000
const DIGITAL = '2026-11-10'

interface Harness {
  service: MoviesService
  deps: MoviesDeps
  clock: { t: number }
  library: Set<number>
  received: { ids: string[]; cid: string }[]
  notified: string[]
}

function setup(info: Partial<MovieInfo> = {}, defaultCid = '555'): Harness {
  const clock = { t: new Date(2026, 9, 25, 10).getTime() }
  const library = new Set<number>()
  const received: { ids: string[]; cid: string }[] = []
  const notified: string[] = []
  const gateState = emptyGate(clock.t)
  const gate = createGate(
    gateState,
    {
      now: () => clock.t,
      sleep: async ms => void (clock.t += ms),
      random: () => 0,
    },
    () => {}
  )
  const movie: MovieInfo = {
    tmdbId: 77,
    title: '疯狂动物城2',
    originalTitle: 'Zootopia 2',
    year: 2026,
    poster: null,
    premiere: '2026-10-20',
    releaseDates: [
      { type: 3, date: '2026-10-20' },
      { type: 4, date: DIGITAL },
    ],
    ...info,
  }
  let saved: unknown = null
  const deps: MoviesDeps = {
    tmdb: { movie: vi.fn(async () => movie), search: async () => [] },
    tmdbReady: () => true,
    inLibrary: async id => library.has(id),
    gate: async () => gate,
    pan: {
      loggedIn: () => true,
      pansouReady: () => true,
      search: vi.fn(async () => [
        {
          title: '疯狂动物城2 2026 4K',
          source: 'x',
          url: 'https://115.com/s/zoo?password=abcd',
          shareCode: 'zoo',
          receiveCode: 'abcd',
        },
      ]),
      snap: async () => ({
        title: '疯狂动物城2',
        count: 1,
        files: [
          {
            id: 'z1',
            name: '疯狂动物城2.2026.2160p.WEB-DL.DDP5.1.中字.mkv',
            size: 12 * GB,
            isDir: false,
          },
        ],
      }),
      receive: async (_u, _p, ids, cid) => void received.push({ ids, cid }),
      names: async () => [],
      dirPath: async () => ['电影'],
    },
    notify: async path => void notified.push(path),
    defaultFolder: () => ({ cid: defaultCid, name: '电影' }),
    load: async () => saved,
    save: async state => void (saved = JSON.parse(JSON.stringify(state))),
    now: () => clock.t,
    emit: () => {},
    log: () => {},
  }
  return {
    service: createMoviesService(deps),
    deps,
    clock,
    library,
    received,
    notified,
  }
}

const statusOf = async (h: Harness): Promise<TrackedMovie> =>
  (await h.service.overview()).movies[0]

describe('电影上线追踪', () => {
  it('数字发行前不搜，发行日 20:00 后开始搜，默认待确认', async () => {
    const h = setup()
    expect(await h.service.track(77)).toEqual({ ok: true })
    await h.service.tick()
    expect(await statusOf(h)).toMatchObject({
      status: 'upcoming',
      releaseDate: DIGITAL,
      dateSource: 'digital',
    })
    expect(h.deps.pan.search).not.toHaveBeenCalled()

    h.clock.t = searchStart(DIGITAL) + 60_000
    await h.service.tick()
    const m = await statusOf(h)
    expect(m.status).toBe('found')
    expect(m.candidates[0].resolution).toBe(2160)
    expect(h.received).toEqual([])

    expect(await h.service.grab(77, 0)).toEqual({ ok: true })
    expect(h.received).toEqual([{ ids: ['z1'], cid: '555' }])
    expect(await h.service.status(77)).toBe('saved')

    h.clock.t += 11 * 60_000
    await h.service.tick()
    expect(h.notified).toEqual([
      '/电影/疯狂动物城2.2026.2160p.WEB-DL.DDP5.1.中字.mkv',
    ])
    h.library.add(77)
    await h.service.tick()
    expect(await h.service.status(77)).toBe('done')
  })

  it('全自动要转存目标不是根目录：没设电影默认目录时先选文件夹；选好后分数过线直接存', async () => {
    const h = setup({ releaseDates: [{ type: 4, date: '2026-10-01' }] }, '0')
    await h.service.track(77)
    expect((await h.service.setMode(77, 'auto')).ok).toBe(false)
    await h.service.setFolder('888', '电影')
    expect((await h.service.setMode(77, 'auto')).ok).toBe(true)
    await h.service.retry(77)
    await h.service.tick()
    expect(h.received).toEqual([{ ids: ['z1'], cid: '888' }])
  })

  it('设了电影默认目录、没在追踪面板选文件夹：全自动照样转存到默认目录', async () => {
    const h = setup({ releaseDates: [{ type: 4, date: '2026-10-01' }] })
    await h.service.track(77)
    expect((await h.service.setMode(77, 'auto')).ok).toBe(true)
    await h.service.retry(77)
    await h.service.tick()
    expect(h.received).toEqual([{ ids: ['z1'], cid: '555' }])
  })

  it('跟随全局：全局切全自动后，跟随的电影直接存；单独设待确认的不存', async () => {
    const h = setup({ releaseDates: [{ type: 4, date: '2026-10-01' }] })
    await h.service.track(77)
    expect((await statusOf(h)).mode).toBe('inherit')
    expect((await statusOf(h)).effectiveMode).toBe('confirm')
    expect((await h.service.setPolicy({ mode: 'auto' })).ok).toBe(true)
    expect((await statusOf(h)).effectiveMode).toBe('auto')
    await h.service.setMode(77, 'confirm')
    await h.service.retry(77)
    await h.service.tick()
    expect(h.received).toEqual([])
    await h.service.setMode(77, 'inherit')
    await h.service.retry(77)
    await h.service.tick()
    expect(h.received).toEqual([{ ids: ['z1'], cid: '555' }])
  })

  it('全局全自动而转存目标是根目录：拒绝', async () => {
    const h = setup({}, '0')
    expect((await h.service.setPolicy({ mode: 'auto' })).ok).toBe(false)
    expect((await h.service.policy()).mode).toBe('confirm')
  })

  it('加入时早已发行：马上搜，从加入那天算 30 天，到期记为没找到', async () => {
    const h = setup({ releaseDates: [{ type: 4, date: '2026-01-01' }] })
    vi.mocked(h.deps.pan.search).mockResolvedValue([])
    await h.service.track(77)
    await h.service.tick()
    expect(h.deps.pan.search).toHaveBeenCalled()
    expect((await statusOf(h)).status).toBe('searching')
    for (let day = 0; day < 31; day++) {
      h.clock.t += DAY
      await h.service.tick()
    }
    expect((await statusOf(h)).status).toBe('notFound')
    await h.service.retry(77)
    expect((await statusOf(h)).status).toBe('searching')
  })

  it('片库里已有就直接完成；取消追踪就删掉', async () => {
    const h = setup()
    h.library.add(77)
    await h.service.track(77)
    await h.service.tick()
    expect(await h.service.status(77)).toBe('done')
    await h.service.untrack(77)
    expect(await h.service.status(77)).toBeNull()
  })

  it('TMDB 没有发行日期也没首映久：等着，过几天再问 TMDB', async () => {
    const h = setup({ releaseDates: [], premiere: '2026-10-20' })
    await h.service.track(77)
    await h.service.tick()
    expect(await statusOf(h)).toMatchObject({
      status: 'upcoming',
      releaseDate: null,
    })
    const calls = vi.mocked(h.deps.tmdb.movie).mock.calls.length
    h.clock.t += 4 * DAY
    await h.service.tick()
    expect(vi.mocked(h.deps.tmdb.movie).mock.calls.length).toBe(calls + 1)
  })
})
