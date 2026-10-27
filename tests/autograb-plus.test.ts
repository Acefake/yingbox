/**
 * 追更补充功能：115 空间检查与暂停、撤销（只删记下的那个文件、删前核对）、偏好持久化、老文件兼容。
 */
import { describe, expect, it } from 'vitest'

import { parseState } from '../src/main/autograb/state'
import { DEFAULT_PREFS } from '../src/shared/contract/autograb-prefs'
import type { AutograbEpisode } from '../src/shared/contract/autograb'
import { FILE_05, GB, episode, namesIn, setup } from './autograb-harness'

const AUTO_SERIES = {
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

async function recordOf(
  h: ReturnType<typeof setup>,
  key = '7:1:5'
): Promise<AutograbEpisode> {
  return (await h.service.overview()).episodes.find(e => e.key === key)!
}

describe('追更 · 115 剩余空间', () => {
  it('空间不够「体积 + 1GB」：不转存，这一集标空间不足，全局暂停自动转存', async () => {
    const h = setup([episode(5)])
    h.space.remain = 2.5 * GB
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    const result = await h.service.grab('7:1:5', 0)
    expect(result.ok).toBe(false)
    expect(h.received).toEqual([])
    const record = await recordOf(h)
    expect(record.status).toBe('noSpace')
    expect(record.error).toContain('空间不足')
    expect(record.candidates).toHaveLength(1)
    expect((await h.service.overview()).spacePaused).toContain('空间不足')
  })

  it('暂停期间全自动不转存；清理后手动转存成功即解除暂停', async () => {
    const h = setup([episode(5), episode(6)], AUTO_SERIES)
    h.space.remain = 2 * GB
    await h.service.tick()
    expect(h.received).toEqual([])
    expect((await h.service.overview()).spacePaused).not.toBeNull()
    h.space.remain = 50 * GB
    expect(await h.service.grab('7:1:5', 0)).toEqual({ ok: true })
    expect((await h.service.overview()).spacePaused).toBeNull()
  })

  it('点恢复解除空间暂停', async () => {
    const h = setup([episode(5)], { ...AUTO_SERIES, spacePause: '满了' })
    expect((await h.service.overview()).spacePaused).toBe('满了')
    await h.service.resume()
    expect((await h.service.overview()).spacePaused).toBeNull()
  })
})

describe('追更 · 撤销', () => {
  it('删掉记下的那个文件，回到缺集，候选拉黑，通知媒体库删除', async () => {
    const h = setup([episode(5)])
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    await h.service.grab('7:1:5', 0)
    expect((await recordOf(h)).revertable).toBe(true)

    expect(await h.service.revert('7:1:5')).toEqual({ ok: true })
    expect(h.removed).toEqual(['9101'])
    expect(namesIn(h, '0')).toEqual([])
    expect(h.notified).toContain(`delete /剧集/繁花/${FILE_05}`)
    await h.service.tick()
    const record = await recordOf(h)
    expect(record.status).toBe('waiting')
    expect(record.attempts).toBe(2)
    expect(record.revertable).toBe(false)
    // 同一个分享文件被拉黑，重新搜也不会再列出
    expect(record.candidates).toEqual([])
  })

  it('媒体库刷新前日历还挂着被删的文件：不算已入库；换成别的文件才算', async () => {
    const eps = [episode(5)]
    const h = setup(eps)
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    await h.service.grab('7:1:5', 0)
    await h.service.revert('7:1:5')
    eps[0] = episode(5, 99, `/mnt/115/剧集/繁花/${FILE_05}`)
    await h.service.tick()
    expect((await recordOf(h)).status).toBe('waiting')
    eps[0] = episode(5, 100, '/mnt/115/剧集/繁花/繁花.E05.1080p.mkv')
    await h.service.tick()
    expect((await recordOf(h)).status).toBe('done')
  })

  it('115 里文件大小和转存时不一致：不删', async () => {
    const h = setup([episode(5)])
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    await h.service.grab('7:1:5', 0)
    h.files.get('0')![0].size = 3 * GB
    const result = await h.service.revert('7:1:5')
    expect(result.ok).toBe(false)
    expect(h.removed).toEqual([])
    expect((await recordOf(h)).status).toBe('saved')
  })

  it('同名文件本来就在（不是追更存的）：不能撤销', async () => {
    const h = setup([episode(5)])
    h.files.set('0', [{ id: '1', name: FILE_05, size: 2 * GB, isDir: false }])
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    await h.service.grab('7:1:5', 0)
    expect((await recordOf(h)).revertable).toBe(false)
    expect((await h.service.revert('7:1:5')).ok).toBe(false)
    expect(h.removed).toEqual([])
  })
})

describe('追更 · 偏好', () => {
  it('全局排除词命中就没有候选；每剧覆盖持久化', async () => {
    const h = setup([episode(5)])
    await h.service.setPrefs({ ...DEFAULT_PREFS, excludeWords: ['2160p'] })
    await h.service.setSeries(7, {
      mode: 'confirm',
      prefs: { resolution: '1080p' },
    })
    await h.service.tick()
    const overview = await h.service.overview()
    expect(overview.prefs.excludeWords).toEqual(['2160p'])
    expect(overview.series.find(s => s.seriesId === 7)!.prefs).toEqual({
      resolution: '1080p',
    })
    expect((await recordOf(h)).candidates).toEqual([])
  })

  it('老文件没有新字段：读成默认值；坏字段丢掉', () => {
    const state = parseState(
      {
        version: 1,
        prefs: { resolution: '8k', excludeWords: ['枪版', 3], minMb: -1 },
        series: { '7': { title: 'A', mode: 'confirm', prefs: 'x' } },
        episodes: {
          '7:1:1': {
            seriesId: 7,
            season: 1,
            episode: 1,
            airDate: '2026-10-01',
            status: 'saved',
            savedName: 'a.mkv',
            savedCid: '5',
          },
        },
      },
      0
    )
    expect(state.prefs).toEqual({ ...DEFAULT_PREFS, excludeWords: ['枪版'] })
    expect(state.spacePause).toBeNull()
    expect(state.series['7'].prefs).toEqual({})
    const record = state.episodes['7:1:1']
    expect(record.savedFileId).toBeNull()
    expect(record.banned).toEqual([])
    expect(record.revertedName).toBeNull()
  })
})
