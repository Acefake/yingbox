import { describe, expect, it } from 'vitest'

import { Pan115Error } from '../src/main/pan115/errors'
import { FILE_05, episode, namesIn, setup } from './autograb-harness'

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
    expect(namesIn(h, '66')).toEqual([FILE_05])

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
