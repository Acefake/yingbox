import { describe, expect, it, vi } from 'vitest'
import { createSeriesCatalog } from '../src/main/autograb/catalog'
import { migrateAutograb } from '../src/main/autograb/migration'
import { episode, setup } from './autograb-harness'
import { emptyState } from '../src/main/autograb/state'
import { applyCalendar } from '../src/main/autograb/records'
import {
  createLibraryLinks,
  libraryLandedRecords,
} from '../src/main/autograb/library-links'

const info = {
  tmdbId: '99',
  title: '繁花',
  originalTitle: '繁花',
  year: 2026,
  poster: 'https://image.tmdb.org/t/p/w500/test.jpg',
  category: 'tv' as const,
}
const get = vi.fn(async (path: string): Promise<unknown> => {
  if (path === '/search/tv')
    return { results: [{ id: 99, name: '繁花', first_air_date: '2026-10-20' }] }
  if (path === '/tv/99')
    return {
      id: 99,
      name: '繁花',
      original_name: '繁花',
      first_air_date: '2026-10-20',
      poster_path: '/test.jpg',
      seasons: [{ season_number: 1, air_date: '2026-10-20' }],
    }
  return {
    episodes: [1, 2].map(n => ({
      episode_number: n,
      air_date: '2026-10-20',
      name: `第${n}集`,
    })),
  }
})

describe('不依赖媒体库的网盘追剧', () => {
  it('启动保存失败时并发检查及重复启动不会提前运行任务', async () => {
    const h = setup([])
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    const id = await h.service.track(info)
    let reject = (_error: Error): void => {}
    const delayed = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const save = vi.fn(async () => delayed)
    h.deps.save = save
    const started = h.service.startSeries(id)
    const repeated = h.service.startSeries(id)
    const results = Promise.allSettled([started, repeated])
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await h.service.tick()
    expect((await h.service.overview()).series[0].pending).toBe(true)
    expect((await h.service.overview()).episodes).toEqual([])
    expect(h.received).toEqual([])
    reject(new Error('disk full'))
    expect((await results).map(result => result.status)).toEqual([
      'rejected',
      'rejected',
    ])
    expect((await h.service.overview()).series[0].pending).toBe(true)
  })

  it('直接匹配 TMDB 并获取分集，失败不缓存为空；按天复用元数据', async () => {
    get.mockClear()
    const catalog = createSeriesCatalog(
      get,
      () => 'zh-CN',
      () => Date.parse('2026-10-21')
    )
    expect(await catalog.resolve({ title: '繁花', year: 2026 })).toMatchObject({
      status: 'ready',
      info: { tmdbId: '99' },
    })
    const tasks = {
      '1': {
        ...info,
        mode: 'auto' as const,
        cid: '8',
        cidName: '',
        confirmed: 0,
        prefs: {},
      },
    }
    const range = { from: '2026-10-01', to: '2026-10-31' }
    expect(
      (await catalog.calendar(range, tasks)).episodes.map(e => e.episode)
    ).toEqual([1, 2])
    await catalog.calendar(range, tasks)
    expect(
      get.mock.calls.filter(([path]) => path.endsWith('/season/1'))
    ).toHaveLength(1)
    const failure = createSeriesCatalog(
      async () => {
        throw new Error('offline')
      },
      () => 'zh-CN'
    )
    await expect(failure.calendar(range, tasks)).rejects.toThrow(
      '获取追剧分集失败'
    )
  })

  it('零媒体库也能创建任务、转存合集，纯网盘任务不等待入库', async () => {
    const h = setup([])
    const catalog = createSeriesCatalog(
      get,
      () => 'zh-CN',
      () => h.clock.t
    )
    h.deps.calendar = (range, tasks) => catalog.calendar(range, tasks)
    h.deps.seriesEpisodes = (id, to, setting) =>
      catalog.episodes(id, setting!, { from: '1900-01-01', to })
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    h.deps.followsLibrary = () => false
    h.deps.notify = vi.fn()
    h.deps.pan.receive = async (_url, _password, ids, cid) => {
      h.received.push(ids)
      h.files.set(cid, [
        ...(h.files.get(cid) ?? []),
        ...ids.map(id => ({
          id: `9${id}`,
          name: `繁花.S01E0${Number(id) - 100}.2160p.WEB-DL.mkv`,
          isDir: false,
          size: 1024 ** 3,
        })),
      ])
    }
    await h.service.setPolicy({ mode: 'auto' })
    h.deps.pan.snap = async () => ({
      title: '繁花',
      count: 2,
      files: [1, 2].map(n => ({
        id: String(100 + n),
        name: `繁花.S01E0${n}.2160p.WEB-DL.mkv`,
        isDir: false,
        size: 1024 ** 3,
      })),
    })
    const id = await h.service.track(info)
    expect(await h.service.track(info)).toBe(id)
    await h.service.backfill(id)
    await h.service.setSeries(id, { mode: 'auto', cid: '88' })
    await h.service.tick()
    expect(h.received).toEqual([])
    expect((await h.service.overview()).series[0].pending).toBe(true)
    expect((await h.service.overview()).episodes).toEqual([])
    expect(await h.service.startSeries(id)).toEqual({ ok: true })
    await h.service.tick()
    expect(h.received).toEqual([['101'], ['102']])
    h.clock.t += 2 * 3_600_000
    await h.service.tick()
    const overview = await h.service.overview()
    expect(
      overview.episodes.every(
        e => e.status === 'saved' && !e.error && e.libraryLinked === false
      )
    ).toBe(true)
    expect(h.deps.notify).not.toHaveBeenCalled()
    await h.service.setSeries(id, { mode: 'off' })
    expect((await h.service.overview()).series).toEqual([])
    expect((await h.service.overview()).episodes).toEqual([])
    expect(h.removed).toEqual([])
    const next = await h.service.track(info)
    expect(next).not.toBe(id)
  })

  it('取消正在搜索的任务，不把异步候选写回、不转存', async () => {
    const h = setup([episode(1), episode(2)])
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    let release = (): void => {}
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const entered = vi.fn()
    h.deps.pan.search = async () => {
      entered()
      await waiting
      return []
    }
    const id = await h.service.track(info)
    h.deps.calendar = async () => ({
      configured: true,
      series: 1,
      failed: 0,
      episodes: [episode(1), episode(2)].map(e => ({ ...e, seriesId: id })),
    })
    await h.service.startSeries(id)
    const tick = h.service.tick()
    await vi.waitFor(() => expect(entered).toHaveBeenCalled())
    await h.service.setSeries(id, { mode: 'off' })
    release()
    await tick
    expect((await h.service.overview()).series).toEqual([])
    expect((await h.service.overview()).episodes).toEqual([])
    expect(h.received).toEqual([])
  })

  it('迁移保留在追任务、目录及已转存记录，移除取消记录；重复迁移幂等', async () => {
    const raw = emptyState(Date.now())
    raw.series['7'] = {
      ...info,
      mode: 'auto',
      cid: '88',
      cidName: '剧集',
      confirmed: 2,
      prefs: {},
    }
    raw.series['8'] = {
      title: '已取消',
      mode: 'off',
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
    }
    const lookup = vi.fn(async () => info)
    applyCalendar(raw, [episode(1)], '2026-10-21')
    Object.assign(raw.episodes['7:1:1'], {
      status: 'saved',
      savedAt: 10,
      savedCid: '88',
      savedName: 'one.mkv',
      savedFileId: '123',
    })
    const migrated = await migrateAutograb(raw, Date.now(), lookup)
    expect(migrated.version).toBe(2)
    expect(migrated.nextSeriesId).toBeGreaterThan(8)
    expect(Object.keys(migrated.series)).toEqual(['7'])
    expect(migrated.series['7']).toMatchObject({
      tmdbId: '99',
      libraryItemId: 7,
      cid: '88',
    })
    expect(migrated.episodes['7:1:1']).toMatchObject({
      status: 'saved',
      savedFileId: '123',
      savedCid: '88',
    })
    const again = await migrateAutograb(migrated, Date.now(), lookup)
    expect(again).toEqual(migrated)
    expect(lookup).toHaveBeenCalledOnce()
  })

  it('迁移合并同 TMDB 任务时保留目录、确认门槛、偏好、跳过及禁止候选', async () => {
    const raw = emptyState(Date.now())
    raw.series['7'] = {
      ...info,
      mode: 'auto',
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
    }
    raw.series['8'] = {
      ...info,
      mode: 'auto',
      cid: '88',
      cidName: '剧集',
      confirmed: 4,
      confirmFirst: 3,
      prefs: { preferWords: ['WEB'] },
    }
    applyCalendar(
      raw,
      [episode(1), { ...episode(1), seriesId: 8 }],
      '2026-10-21'
    )
    raw.episodes['7:1:1'].banned = ['a/1']
    Object.assign(raw.episodes['8:1:1'], { status: 'skipped', banned: ['b/2'] })
    const migrated = await migrateAutograb(raw, Date.now(), async () => info)
    expect(migrated.series['7']).toMatchObject({
      cid: '88',
      confirmed: 4,
      confirmFirst: 3,
    })
    expect(migrated.episodes['7:1:1']).toMatchObject({
      status: 'skipped',
      banned: expect.arrayContaining(['a/1', 'b/2']),
    })
    expect(migrated.episodes['8:1:1']).toBeUndefined()
  })

  it('库离线时仅暂不使用关联，不把条目错配当作正确目录', async () => {
    const tasks = new Map([
      [
        1,
        {
          ...info,
          mode: 'auto' as const,
          cid: '',
          cidName: '',
          confirmed: 0,
          prefs: {},
          libraryItemId: 7,
          syncLibrary: true,
        },
      ],
    ])
    const read = async (): Promise<never> => {
      throw new Error('offline')
    }
    const links = createLibraryLinks(read, tasks)
    expect(await links.verify(1)).toBeNull()
    expect(tasks.get(1)?.libraryItemId).toBe(7)
  })

  it('媒体库条目 ID 被另一剧复用时解除关联，不使用该剧目录或文件', async () => {
    const tasks = new Map([
      [
        1,
        {
          ...info,
          mode: 'auto' as const,
          cid: '',
          cidName: '',
          confirmed: 0,
          prefs: {},
          libraryItemId: 7,
          syncLibrary: true,
        },
      ],
    ])
    const links = createLibraryLinks(
      async () => ({ id: 7, type: 'series', providerIds: { tmdb: '100' } }),
      tasks
    )
    expect(await links.verify(1)).toBeNull()
    expect(tasks.get(1)?.libraryItemId).toBeUndefined()
    expect(tasks.get(1)?.syncLibrary).toBe(false)
  })

  it('入库通知按媒体库身份去重，不把任务句柄当条目 id', () => {
    const state = emptyState(Date.now())
    state.series['7'] = {
      ...info,
      mode: 'auto',
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
      libraryItemId: 99,
    }
    applyCalendar(state, [episode(1)], '2026-10-21')
    const source = state.episodes['7:1:1']
    expect(
      libraryLandedRecords([source], new Map([[7, state.series['7']]]))[0]
        .seriesId
    ).toBe(99)
    expect(source.seriesId).toBe(7)
    expect(libraryLandedRecords([source], new Map())).toEqual([])
  })
})
