// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AutograbOverview,
  AutograbSeries,
} from '../src/shared/contract/autograb'
import { policyOf } from '../src/shared/contract/grab-policy'
import { seriesProgress } from '../src/renderer/src/features/autograb/series-progress'
import { showTrackingError } from '../src/renderer/src/features/autograb/tracking-error'

const { confirm, error } = vi.hoisted(() => ({
  confirm: vi.fn(),
  error: vi.fn(),
}))
vi.mock('../src/renderer/src/components/ui/confirm', () => ({
  confirmDialog: confirm,
}))
vi.mock('../src/renderer/src/components/ui/toast', () => ({ toast: { error } }))

const series: AutograbSeries = {
  seriesId: 7,
  title: '某剧',
  mode: 'auto',
  effectiveMode: 'auto',
  confirmFirst: 0,
  confirmed: 0,
  cid: '',
  cidName: '',
  prefs: {},
}
const data = (): AutograbOverview => ({
  enabled: true,
  pausedUntil: null,
  pauseReason: null,
  spacePaused: null,
  policy: policyOf(undefined, 'tv'),
  prefs: policyOf(undefined, 'tv').prefs,
  ready: { loggedIn: true, pansou: true },
  today: { snaps: 0, receives: 0 },
  series: [series],
  episodes: [],
  running: false,
  defaultFolder: { cid: '88', name: '剧集' },
})

beforeEach(() => vi.clearAllMocks())

describe('独立网盘追剧的错误反馈', () => {
  it('直接显示业务错误，不引导创建媒体库', async () => {
    await showTrackingError(
      new Error(
        "Error invoking remote method 'autograb:trackOnline': Error: [library:network] TMDB 请求失败"
      )
    )
    expect(error).toHaveBeenCalledWith('TMDB 请求失败')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('合集优先状态', () => {
  it('没有阶段数据时不虚构正在搜索，旧服务仍说明策略', () => {
    expect(seriesProgress(data(), series)).toMatchObject({
      title: '先找合集，再补单集',
      busy: false,
    })
  })
  it('读取本剧的搜索阶段，不串到别的剧', () => {
    const overview = data()
    overview.packSearch = [
      { seriesId: 8, status: 'searching', matched: 0, total: 10 },
    ]
    expect(seriesProgress(overview, series).busy).toBe(false)
    overview.packSearch[0].seriesId = 7
    expect(seriesProgress(overview, series)).toMatchObject({
      title: '正在查找合集',
      busy: true,
    })
  })
  it('暂停、缺少配置、总开关关闭时不显示正在搜索', () => {
    const overview = data()
    overview.packSearch = [
      { seriesId: 7, status: 'searching', matched: 0, total: 10 },
    ]
    overview.ready.loggedIn = false
    expect(seriesProgress(overview, series)).toMatchObject({
      busy: false,
      description: expect.stringContaining('115'),
    })
    overview.enabled = false
    expect(seriesProgress(overview, series).title).toBe('自动追更已关闭')
  })
  it('完成后区分自动转存和待确认；失败后说明补搜', () => {
    const overview = data()
    overview.packSearch = [
      { seriesId: 7, status: 'complete', matched: 8, total: 10 },
    ]
    expect(seriesProgress(overview, series)).toMatchObject({
      title: '上次合集已匹配 8 / 10 个缺集',
      busy: false,
    })
    expect(
      seriesProgress(overview, { ...series, effectiveMode: 'confirm' })
        .description
    ).toContain('确认转存')
    overview.packSearch[0].status = 'failed'
    expect(seriesProgress(overview, series).title).toBe('上次合集搜索未完成')
  })
})
