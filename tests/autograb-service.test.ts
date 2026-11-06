import { describe, expect, it } from 'vitest'

import { Pan115Error } from '../src/main/pan115/errors'
import { FILE_05, child, episode, namesIn, setup } from './autograb-harness'

describe('追更服务', () => {
  it('存整部剧：登记后开始追更的第一轮把已播出的缺集全建成记录，只做一次', async () => {
    const { service, deps } = setup([episode(5)])
    const all = [1, 2, 3].map(n => ({
      ...episode(n),
      airDate: n === 1 ? '2026-09-01' : '2026-10-20',
    }))
    const asked: number[] = []
    deps.seriesEpisodes = async id => {
      asked.push(id)
      return all
    }
    await service.backfill(7)
    await service.tick()
    expect(asked).toEqual([])
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    const eps = (await service.overview()).episodes
      .filter(e => e.seriesId === 7)
      .map(e => e.episode)
      .sort()
    expect(eps).toEqual([1, 2, 3, 5])
    await service.tick()
    expect(asked).toEqual([7])
  })

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

  it('总览：待处理计数、上次 / 下次检查、下一集播出日、海报', async () => {
    const aired = { ...episode(4, 1, '/a/04.mkv'), airDate: '2026-10-10' }
    const upcoming = {
      ...episode(6),
      airDate: '2026-11-01',
      poster: 'https://image.tmdb.org/t/p/w500/p.jpg',
    }
    const h = setup([aired, upcoming, episode(5)])
    h.deps.intervalMs = 30 * 60_000
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    const overview = await h.service.overview()
    // 第 5 集已播出且搜到候选 → 待确认；第 6 集还没播，不算
    expect(overview.pendingCount).toBe(1)
    expect(overview.lastRunAt).toBe(h.clock.t)
    expect(overview.nextRunAt).toBe(h.clock.t + 30 * 60_000)
    expect(overview.series.find(s => s.seriesId === 7)!.nextAirDate).toBe(
      '2026-11-01'
    )
    expect(overview.series.find(s => s.seriesId === 7)!.poster).toBe(
      'https://image.tmdb.org/t/p/w500/p.jpg'
    )
    await h.service.setEnabled(false)
    expect((await h.service.overview()).nextRunAt).toBeNull()
  })

  it('追不在近期日历里的剧：用补丁里的剧名，列表不出现空名', async () => {
    const { service } = setup([episode(5)])
    await service.setSeries(99, { mode: 'confirm', title: '三体' })
    const row = (await service.overview()).series.find(s => s.seriesId === 99)
    expect(row?.title).toBe('三体')
    await service.setSeries(98, { mode: 'confirm' })
    const bare = (await service.overview()).series.find(s => s.seriesId === 98)
    expect(bare?.title).toBe('#98')
  })

  it('全自动：没设文件夹不让开；确认不满门槛（设了新剧先确认 1 集）不自动存', async () => {
    const { service, received } = setup([episode(5)])
    await service.setPolicy({ confirmFirst: 1 })
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
    const h = setup([episode(5)], initial)
    const { service, received } = h
    await service.tick()
    expect(received).toEqual([['101']])
    expect(namesIn(h, '55')).toEqual([FILE_05])
    const record = (await service.overview()).episodes.find(
      e => e.key === '7:1:5'
    )!
    expect(record.status).toBe('saved')
  })

  it('全自动：没单独选文件夹时存到剧集默认目录；单独选了就用自己的', async () => {
    const initial = {
      version: 1,
      series: {
        '7': {
          title: '繁花',
          mode: 'auto',
          cid: '',
          cidName: '',
          confirmed: 3,
        },
      },
    }
    const h = setup([episode(5)], initial)
    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    await h.service.tick()
    expect((await h.service.overview()).defaultFolder.cid).toBe('66')
    // 没单独选文件夹：存到剧集默认目录下这部剧的子文件夹，不平铺
    expect(namesIn(h, child('66'))).toEqual([FILE_05])
    expect(namesIn(h, '66')).toEqual([])

    const own = setup([episode(5)], {
      ...initial,
      series: { '7': { ...initial.series['7'], cid: '55', cidName: '繁花' } },
    })
    own.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    await own.service.tick()
    expect(namesIn(own, '55')).toEqual([FILE_05])
    expect(namesIn(own, '66')).toEqual([])
  })

  it('全自动：设了剧集默认目录就能开；默认目录也是根目录时不让开', async () => {
    const h = setup([episode(5)])
    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    expect(await h.service.setSeries(7, { mode: 'auto' })).toEqual({ ok: true })
    h.deps.defaultFolder = () => ({ cid: '0', name: '' })
    const result = await h.service.setSeries(8, { mode: 'auto' })
    expect(result.ok).toBe(false)
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
    expect(notified).toEqual([`create /剧集/繁花/${FILE_05}`])
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

it('目标目录不存在文件时不能将已接收过标记为转存成功', async () => {
  const h = setup([episode(5)])
  await h.service.setSeries(7, { mode: 'confirm', cid: '55', cidName: '繁花' })
  await h.service.tick()
  h.deps.pan.receive = async () => {
    throw new Pan115Error('已经接收过', 4100024)
  }
  expect((await h.service.grab('7:1:5', 0)).ok).toBe(false)
  expect((await h.service.overview()).episodes[0].status).not.toBe('saved')
})

it('转存后 1 小时仍没入库：再通知一次并报错，写明 115 路径', async () => {
  const { service, clock, notified } = setup([episode(5)])
  await service.setSeries(7, { mode: 'confirm' })
  await service.tick()
  await service.grab('7:1:5', 0)
  clock.t += 11 * 60_000
  await service.tick()
  clock.t += 60 * 60_000
  await service.tick()
  const record = (await service.overview()).episodes[0]
  expect(record.libraryError).toContain(`/剧集/繁花/${FILE_05}`)
  expect(notified).toHaveLength(2)
})

it('入库失败后手动重新入库：再通知一次、清掉报错、重新计时', async () => {
  const { service, clock, notified } = setup([episode(5)])
  await service.setSeries(7, { mode: 'confirm' })
  await service.tick()
  await service.grab('7:1:5', 0)
  clock.t += 11 * 60_000
  await service.tick()
  clock.t += 60 * 60_000
  await service.tick()
  expect((await service.overview()).episodes[0].libraryError).not.toBeNull()
  const before = notified.length

  expect(await service.rescan('7:1:5')).toEqual({ ok: true })

  const record = (await service.overview()).episodes[0]
  expect(record.libraryError).toBeNull()
  expect(record.status).toBe('saved')
  expect(notified.length).toBe(before + 1)
  expect(notified.at(-1)).toContain(`/剧集/繁花/${FILE_05}`)
})

it('重新入库没有媒体库接住时返回原因，保留原报错', async () => {
  const h = setup([episode(5)])
  await h.service.setSeries(7, { mode: 'confirm' })
  await h.service.tick()
  await h.service.grab('7:1:5', 0)
  h.clock.t += 11 * 60_000
  await h.service.tick()
  h.clock.t += 60 * 60_000
  await h.service.tick()
  h.deps.notify = async () => ({ accepted: 0 })

  const result = await h.service.rescan('7:1:5')

  expect(result.ok).toBe(false)
  expect(result.ok === false && result.error).toContain('没有媒体库接住')
  expect((await h.service.overview()).episodes[0].libraryError).not.toBeNull()
})

it('没转存的集不能重新入库', async () => {
  const { service } = setup([episode(5)])
  await service.setSeries(7, { mode: 'confirm' })
  await service.tick()
  const result = await service.rescan('7:1:5')
  expect(result.ok).toBe(false)
})

it('新剧先确认期间搜到的集：条件满足后不用再点，下一轮自动转存', async () => {
  const h = setup([episode(5)])
  h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
  await h.service.setPolicy({ mode: 'auto', confirmFirst: 1 })
  await h.service.tick()
  // 新剧先确认 1 集：搜到了，但没有自动转存
  expect((await h.service.overview()).episodes[0].status).toBe('found')
  expect(h.received).toHaveLength(0)

  // 把「新剧先确认」改成 0 集：这一集不用再点，下一轮自动转存
  await h.service.setPolicy({ confirmFirst: 0 })
  await h.service.tick()
  expect((await h.service.overview()).episodes[0].status).toBe('saved')
  expect(h.received).toEqual([['101']])
})

it('默认不先确认：全局全自动后搜到的集直接自动转存', async () => {
  const h = setup([episode(5)])
  h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
  await h.service.setPolicy({ mode: 'auto' })
  await h.service.tick()
  expect((await h.service.overview()).episodes[0].status).toBe('saved')
  expect(h.received).toEqual([['101']])
})

it('补转存失败过的集不会每一轮重试', async () => {
  const h = setup([episode(5), episode(6)])
  h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
  await h.service.setPolicy({ mode: 'auto', confirmFirst: 0 })
  await h.service.tick()
  // 第 6 集的文件在目录里对不上，转存校验失败；再跑几轮也不重复转存
  const after = h.received.length
  await h.service.tick()
  await h.service.tick()
  expect(h.received).toHaveLength(after)
})
