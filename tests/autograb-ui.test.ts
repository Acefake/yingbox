import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import {
  confirmsLeft,
  episodeCode,
  episodeMark,
  episodeNote,
  groupBySeries,
  historyEpisodes,
  marksOf,
  nextAirText,
  pendingBadge,
  pendingEpisodes,
  prerequisites,
  sizeText,
  statusLine,
  trackedSeries,
  untrackedSeries,
} from '../src/renderer/src/features/autograb/autograb-rules'
import {
  RESOLUTION_OPTIONS,
  draftOfOverride,
  isCustom,
  itemPolicyText,
  overrideOfDraft,
  overrideSummary,
  parseGb,
  parseWords,
  patchPrefs,
  prefsSummary,
  withInherit,
} from '../src/renderer/src/features/autograb/prefs-rules'
import { tmdbSearchPoster } from '../src/renderer/src/features/autograb/series-poster-rules'
import { DEFAULT_PREFS } from '../src/shared/contract/autograb-prefs'
import { DEFAULT_GRAB_PREFS } from '../src/shared/contract/grab-prefs'
import { policyOf } from '../src/shared/contract/grab-policy'
import type {
  AutograbEpisode,
  AutograbOverview,
} from '../src/shared/contract/autograb'

const base: AutograbOverview = {
  enabled: true,
  pausedUntil: null,
  pauseReason: null,
  spacePaused: null,
  policy: policyOf(undefined, 'tv'),
  prefs: DEFAULT_PREFS,
  ready: { loggedIn: true, pansou: true },
  today: { snaps: 0, receives: 0 },
  series: [],
  episodes: [],
  running: false,
  defaultFolder: { cid: '0', name: '' },
}

describe('追更面板规则', () => {
  it('前置条件：登录 > PanSou > 暂停，各带就地操作', () => {
    expect(prerequisites(base)).toEqual([])
    expect(
      prerequisites({ ...base, ready: { loggedIn: false, pansou: false } }).map(
        n => [n.kind, n.action?.to]
      )
    ).toEqual([
      ['login', 'settings-pan'],
      ['pansou', 'settings-pan'],
    ])
    const paused = prerequisites({
      ...base,
      pausedUntil: 1,
      pauseReason: '风控',
    })
    expect(paused).toEqual([
      expect.objectContaining({
        kind: 'paused',
        text: '风控',
        action: { label: '恢复', to: 'resume' },
      }),
    ])
  })

  it('集号、体积、确认数', () => {
    expect(episodeCode({ season: 1, episode: 5 })).toBe('S01E05')
    expect(sizeText(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(sizeText(300 * 1024 ** 2)).toBe('300 MB')
    expect(sizeText(0)).toBe('')
    expect(confirmsLeft(1, 3)).toBe(2)
    expect(confirmsLeft(5, 3)).toBe(0)
    expect(confirmsLeft(0, 1)).toBe(1)
  })

  it('说明：错误优先，其次下次搜索时间', () => {
    const ep: AutograbEpisode = {
      key: '1:1:1',
      seriesId: 1,
      seriesTitle: 'A',
      season: 1,
      episode: 1,
      airDate: '2026-10-20',
      status: 'waiting',
      attempts: 2,
      nextTry: new Date(2026, 9, 26, 8, 0).getTime(),
      candidates: [],
      error: null,
      notified: false,
      revertable: false,
    }
    expect(episodeNote(ep)).toBe('已搜 2 次，10月26日 08:00 再搜')
    expect(episodeNote({ ...ep, error: '没找到' })).toBe('没找到')
    expect(episodeNote({ ...ep, status: 'done', nextTry: null })).toBe('')
  })
})

const ep = (patch: Partial<AutograbEpisode>): AutograbEpisode => ({
  key: '7:1:5',
  seriesId: 7,
  seriesTitle: '繁花',
  season: 1,
  episode: 5,
  airDate: '2026-10-20',
  status: 'waiting',
  attempts: 0,
  nextTry: null,
  candidates: [],
  error: null,
  notified: false,
  revertable: false,
  ...patch,
})

describe('日历卡片的追更小标记', () => {
  it('五种标记', () => {
    const label = (patch: Partial<AutograbEpisode>): string | undefined =>
      episodeMark(ep(patch))?.label
    expect(label({ status: 'waiting' })).toBe('搜索中')
    expect(label({ status: 'found' })).toBe('待确认')
    expect(label({ status: 'saved' })).toBe('已转存')
    expect(label({ status: 'saved', notified: true })).toBe('入库中')
    expect(label({ status: 'saved', error: '一天没入库' })).toBe('失败')
    expect(label({ status: 'notFound' })).toBe('失败')
    expect(label({ status: 'noSpace', error: '空间不足' })).toBe('失败')
    expect(label({ status: 'done' })).toBeUndefined()
    expect(label({ status: 'skipped' })).toBeUndefined()
  })

  it('按「剧 id:季:集」索引；失败说明进悬停文字', () => {
    const marks = marksOf({
      ...base,
      episodes: [
        ep({ status: 'noSpace', error: '115 剩余空间不足' }),
        ep({ key: '7:1:6', episode: 6, status: 'done' }),
      ],
    })
    expect([...marks.keys()]).toEqual(['7:1:5'])
    expect(marks.get('7:1:5')!.title).toContain('空间不足')
  })

  it('空间暂停：提示并可恢复', () => {
    const o = { ...base, spacePaused: '115 剩余空间不足' }
    expect(prerequisites(o)).toEqual([
      expect.objectContaining({
        kind: 'space',
        text: '115 剩余空间不足',
        action: { label: '恢复', to: 'resume' },
      }),
    ])
  })
})

const episode = (
  key: string,
  seriesId: number,
  status: AutograbEpisode['status'],
  airDate = '2026-10-30'
): AutograbEpisode => ({
  key,
  seriesId,
  seriesTitle: `剧${seriesId}`,
  season: 1,
  episode: Number(key.split(':')[2]),
  airDate,
  status,
  attempts: 0,
  nextTry: null,
  candidates: [],
  error: null,
  notified: false,
  revertable: false,
})

const series = (
  seriesId: number,
  effectiveMode: 'off' | 'confirm'
): AutograbOverview['series'][number] => ({
  seriesId,
  title: `剧${seriesId}`,
  mode: 'inherit',
  effectiveMode,
  confirmFirst: 0,
  cid: '',
  cidName: '',
  confirmed: 0,
  prefs: {},
  nextAirDate: null,
})

describe('自动追更页规则', () => {
  const o: AutograbOverview = {
    ...base,
    episodes: [
      episode('1:1:1', 1, 'done'),
      episode('1:1:2', 1, 'notFound', '2026-10-31'),
      episode('2:1:1', 2, 'found', '2026-10-29'),
      episode('1:1:3', 1, 'found', '2026-10-30'),
      episode('2:1:2', 2, 'noSpace', '2026-10-30'),
      episode('3:1:1', 3, 'saved'),
      episode('3:1:2', 3, 'waiting'),
    ],
  }

  it('待处理：有候选的在前，再按播出日倒序；记录只含已转存 / 入库 / 跳过', () => {
    expect(pendingEpisodes(o).map(ep => ep.key)).toEqual([
      '1:1:3',
      '2:1:1',
      '1:1:2',
      '2:1:2',
    ])
    expect(historyEpisodes(o).map(ep => ep.key)).toEqual(['1:1:1', '3:1:1'])
    expect(pendingEpisodes(null)).toEqual([])
  })

  it('角标：优先用后端的全量计数，不带计数的片库服务退回数列出的集', () => {
    expect(pendingBadge(o)).toBe(4)
    expect(pendingBadge({ ...o, pendingCount: 9 })).toBe(9)
    expect(pendingBadge(null)).toBe(0)
  })

  it('待处理按剧分组，组顺序跟第一集', () => {
    const groups = groupBySeries(pendingEpisodes(o))
    expect(groups.map(g => [g.seriesId, g.episodes.length])).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('在追 / 没在追的剧、下一集播出日', () => {
    const list = {
      ...base,
      series: [series(1, 'confirm'), series(2, 'off')],
    }
    expect(trackedSeries(list).map(s => s.seriesId)).toEqual([1])
    expect(untrackedSeries(list).map(s => s.seriesId)).toEqual([2])
    expect(
      nextAirText({ ...series(1, 'confirm'), nextAirDate: '2026-11-03' })
    ).toBe('下一集 11月3日')
    expect(nextAirText(series(1, 'confirm'))).toBe('')
  })

  it('状态句：开关、检查中、上次 / 下次', () => {
    expect(statusLine({ ...base, enabled: false })).toBe('已关闭')
    expect(statusLine({ ...base, running: true })).toBe('开启 · 正在检查')
    expect(statusLine(base)).toBe('开启')
    const last = new Date(2026, 9, 31, 14, 0).getTime()
    expect(
      statusLine({ ...base, lastRunAt: last, nextRunAt: last + 30 * 60_000 })
    ).toBe('开启 · 上次 14:00 检查 · 下次约 14:30')
  })
})

describe('追更偏好表单', () => {
  it('词表与体积的文本互转', () => {
    expect(parseWords('ADWeb，WEB-DL, 国语、 ')).toEqual([
      'ADWeb',
      'WEB-DL',
      '国语',
    ])
    expect(parseGb('1.5')).toBe(1536)
    expect(parseGb('')).toBeNull()
    expect(parseGb('-1')).toBeNull()
  })

  it('每部覆盖：跟随与空字段不写，其余照写', () => {
    const draft = draftOfOverride({})
    expect(draft.resolution).toBe('inherit')
    expect(draft.dolbyVision).toBe('inherit')
    expect(overrideOfDraft(draft)).toEqual({})
    expect(
      overrideOfDraft({
        ...draft,
        resolution: '1080p',
        dolbyVision: 'avoid',
        chineseSubs: 'require',
        exclude: 'HDR',
        max: '8',
      })
    ).toEqual({
      resolution: '1080p',
      dolbyVision: 'avoid',
      chineseSubs: 'require',
      excludeWords: ['HDR'],
      maxMb: 8192,
    })
    expect(draftOfOverride({ strategy: 'compact', minMb: 512 })).toMatchObject({
      strategy: 'compact',
      min: '0.5',
    })
  })

  it('摘要：全局写取向与动过的项，覆盖只写设了的', () => {
    expect(prefsSummary(DEFAULT_GRAB_PREFS)).toBe('均衡')
    expect(
      prefsSummary({
        ...DEFAULT_GRAB_PREFS,
        strategy: 'quality',
        resolution: '2160p',
        dolbyVision: 'prefer',
        chineseSubs: 'require',
      })
    ).toBe('画质优先 · 4K · 优先 DV · 必须中字')
    expect(
      overrideSummary({ resolution: '1080p', excludeWords: ['HDR'] })
    ).toBe('1080p · 排除 HDR')
    expect(overrideSummary({ minResolution: '1080p', hdr: 'avoid' })).toBe(
      '至少 1080p · 避开 HDR'
    )
    expect(overrideSummary({})).toBe('')
  })

  it('跟随 / 单独设：方式单独设或覆盖了偏好都算单独', () => {
    expect(isCustom('inherit', {})).toBe(false)
    expect(isCustom('auto', {})).toBe(true)
    expect(isCustom('inherit', { resolution: '2160p' })).toBe(true)
    expect(itemPolicyText(false, 'auto')).toBe('跟随 · 全自动')
    expect(itemPolicyText(true, 'confirm')).toBe('单独 · 待确认')
  })

  it('「跟随」选项写全局值；全局改一项拼出整份偏好', () => {
    const options = withInherit(RESOLUTION_OPTIONS, '2160p')
    expect(options[0]).toEqual({
      value: 'inherit',
      label: '跟随',
      title: '跟随全局（4K）',
    })
    expect(options).toHaveLength(RESOLUTION_OPTIONS.length + 1)
    const next = patchPrefs(DEFAULT_GRAB_PREFS, {
      hdr: 'avoid',
      prefer: 'ADWeb，WEB-DL',
      max: '20',
    })
    expect(next).toMatchObject({
      hdr: 'avoid',
      preferWords: ['ADWeb', 'WEB-DL'],
      maxMb: 20480,
      strategy: 'balanced',
    })
    expect(patchPrefs(next, { max: '' }).maxMb).toBeNull()
  })
})

const SFCS = [
  'features/autograb/components/AutograbView.vue',
  'features/autograb/components/PendingList.vue',
  'features/autograb/components/TrackedSeriesList.vue',
  'features/autograb/components/GrabSheet.vue',
  'features/autograb/components/SeriesGrabSheet.vue',
  'features/autograb/components/EpisodeGrabSheet.vue',
  'features/autograb/components/SeriesTrackButton.vue',
  'features/autograb/components/GrabPoster.vue',
  'features/autograb-upgrade/views/AutograbPage.vue',
  'features/autograb/components/AutograbEpisodes.vue',
  'features/autograb/components/GrabOverrideForm.vue',
  'features/autograb/components/ItemPolicyMenu.vue',
  'features/autograb/components/AutograbMarkChip.vue',
  'features/autograb-upgrade/components/MoviesPanel.vue',
  'features/autograb-upgrade/components/UpgradePanel.vue',
  'features/autograb-upgrade/settings/AutograbSettings.vue',
  'features/autograb-upgrade/settings/KindPolicyGroup.vue',
  'features/autograb-upgrade/settings/KindPrefsGroup.vue',
  'components/ui/UiGlassSelect.vue',
  'features/online/components/DoubanBrowse.vue',
]

describe('追更与自动追更设置组件', () => {
  it.each(SFCS)('%s 能编译', name => {
    const path = join(__dirname, '..', 'src/renderer/src', name)
    const { descriptor, errors } = parse(readFileSync(path, 'utf8'), {
      filename: path,
    })
    expect(errors).toEqual([])
    compileScript(descriptor, { id: name, inlineTemplate: true })
    const template = compileTemplate({
      source: descriptor.template!.content,
      filename: path,
      id: name,
    })
    expect(template.errors).toEqual([])
  })
})

describe('剧海报兜底', () => {
  it('TMDB 搜剧结果：取第一条有海报的', () => {
    expect(
      tmdbSearchPoster({
        results: [
          { poster_path: null },
          { poster_path: '/a.jpg' },
          { poster_path: '/b.jpg' },
        ],
      })
    ).toBe('https://image.tmdb.org/t/p/w342/a.jpg')
    expect(tmdbSearchPoster({ results: [] })).toBeNull()
    expect(tmdbSearchPoster(null)).toBeNull()
    expect(tmdbSearchPoster({ results: [{ poster_path: 'x' }] })).toBeNull()
  })
})
