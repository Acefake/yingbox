/**
 * 追更策略：剧集的全局方式 / 新剧先确认几集 / 资源偏好，每部剧跟随全局或单独设；老文件迁移；
 * 全局全自动的根目录拦截。
 */
import { describe, expect, it } from 'vitest'

import { parseState } from '../src/main/autograb/state'
import {
  effectiveMode,
  policyOf,
  policyPatchOf,
} from '../src/shared/contract/grab-policy'
import { FILE_05, episode, namesIn, setup } from './autograb-harness'

describe('追更策略 · 契约', () => {
  it('默认：剧集不追、新剧先确认 1 集；电影待确认；电影没有「不追」', () => {
    expect(policyOf(undefined, 'tv')).toMatchObject({
      mode: 'off',
      confirmFirst: 1,
    })
    expect(policyOf(undefined, 'movie').mode).toBe('confirm')
    expect(policyPatchOf({ mode: 'off' }, 'movie')).toEqual({})
    expect(policyPatchOf({ mode: 'auto', confirmFirst: 99 }, 'tv')).toEqual({
      mode: 'auto',
    })
    expect(effectiveMode('inherit', { mode: 'auto' })).toBe('auto')
    expect(effectiveMode(undefined, { mode: 'confirm' })).toBe('confirm')
    expect(effectiveMode('off', { mode: 'auto' })).toBe('off')
  })
})

describe('追更策略 · 老文件迁移', () => {
  it('不追 → 跟随全局；待确认 / 全自动保持并沿用 3 集门槛；全局偏好 ← 老 prefs', () => {
    const state = parseState(
      {
        version: 1,
        prefs: { resolution: '1080p' },
        series: {
          '1': { title: 'A', mode: 'off', cid: '' },
          '2': { title: 'B', mode: 'confirm', cid: '' },
          '3': { title: 'C', mode: 'auto', cid: '9', confirmed: 1 },
        },
      },
      0
    )
    expect(state.policy.mode).toBe('off')
    expect(state.policy.prefs.resolution).toBe('1080p')
    expect(state.series['1'].mode).toBe('inherit')
    expect(state.series['1'].confirmFirst).toBeUndefined()
    expect(state.series['2']).toMatchObject({
      mode: 'confirm',
      confirmFirst: 3,
    })
    expect(state.series['3']).toMatchObject({ mode: 'auto', confirmFirst: 3 })
  })

  it('新格式原样读回（含单剧门槛）', () => {
    const state = parseState(
      {
        version: 1,
        policy: {
          mode: 'auto',
          confirmFirst: 0,
          prefs: { strategy: 'quality' },
        },
        series: {
          '1': { title: 'A', mode: 'inherit', cid: '' },
          '2': { title: 'B', mode: 'auto', cid: '', confirmFirst: 3 },
        },
      },
      0
    )
    expect(state.policy).toMatchObject({ mode: 'auto', confirmFirst: 0 })
    expect(state.policy.prefs.strategy).toBe('quality')
    expect(state.series['1'].mode).toBe('inherit')
    expect(state.series['2'].confirmFirst).toBe(3)
  })
})

describe('追更策略 · 服务', () => {
  it('全局待确认：没设过的在播剧也会搜，列出候选不转存', async () => {
    const h = setup([episode(5)])
    expect((await h.service.setPolicy({ mode: 'confirm' })).ok).toBe(true)
    await h.service.tick()
    const overview = await h.service.overview()
    const series = overview.series.find(s => s.seriesId === 7)!
    expect(series).toMatchObject({ mode: 'inherit', effectiveMode: 'confirm' })
    expect(overview.episodes.find(e => e.key === '7:1:5')!.status).toBe('found')
    expect(h.received).toEqual([])
  })

  it('全局全自动：剧集默认目录是根目录时拒绝；设了默认目录后，新剧先确认 1 集再自动存', async () => {
    const h = setup([episode(5), episode(6)])
    expect((await h.service.setPolicy({ mode: 'auto' })).ok).toBe(false)
    expect((await h.service.policy()).mode).toBe('off')

    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    expect((await h.service.setPolicy({ mode: 'auto' })).ok).toBe(true)
    await h.service.tick()
    // 还没确认过：两集都只列候选
    expect(h.received).toEqual([])
    expect(await h.service.grab('7:1:5', 0)).toEqual({ ok: true })
    expect(namesIn(h, '66')).toEqual([FILE_05])
    // 确认满 1 集后，下一集自动存
    await h.service.retry('7:1:6')
    await h.service.tick()
    expect(h.received).toEqual([['101'], ['102']])
  })

  it('单独设「不追」的剧不受全局影响；改回跟随全局后跟着全局走', async () => {
    const h = setup([episode(5)])
    await h.service.setSeries(7, { mode: 'off' })
    await h.service.setPolicy({ mode: 'confirm' })
    await h.service.tick()
    expect(h.deps.pan.search).not.toHaveBeenCalled()
    await h.service.setSeries(7, { mode: 'inherit' })
    await h.service.tick()
    expect(h.deps.pan.search).toHaveBeenCalled()
  })

  it('只改文件夹不会把跟随全局的剧钉成「不追」', async () => {
    const h = setup([episode(5)])
    await h.service.setSeries(7, { cid: '55', cidName: '繁花' })
    const series = (await h.service.overview()).series.find(
      s => s.seriesId === 7
    )!
    expect(series.mode).toBe('inherit')
  })

  it('全局资源偏好进认文件：排除词命中就没有候选', async () => {
    const h = setup([episode(5)])
    const prefs = (await h.service.policy()).prefs
    await h.service.setPolicy({
      mode: 'confirm',
      prefs: { ...prefs, excludeWords: ['2160p'] },
    })
    await h.service.tick()
    const record = (await h.service.overview()).episodes.find(
      e => e.key === '7:1:5'
    )!
    expect(record.candidates).toEqual([])
  })
})
