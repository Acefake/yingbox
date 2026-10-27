import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import {
  canResume,
  confirmsLeft,
  episodeCode,
  episodeMark,
  episodeNote,
  marksOf,
  overviewNotice,
  sizeText,
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
  it('提示优先级：登录 > PanSou > 暂停 > 关闭', () => {
    expect(overviewNotice(base)).toBeNull()
    expect(
      overviewNotice({ ...base, ready: { loggedIn: false, pansou: false } })
    ).toContain('扫码')
    expect(
      overviewNotice({ ...base, ready: { loggedIn: true, pansou: false } })
    ).toContain('PanSou')
    expect(
      overviewNotice({ ...base, pausedUntil: 1, pauseReason: '风控' })
    ).toBe('风控')
    expect(overviewNotice({ ...base, enabled: false })).toBe('追更已关闭')
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
    expect(overviewNotice(o)).toBe('115 剩余空间不足')
    expect(canResume(o)).toBe(true)
    expect(canResume(base)).toBe(false)
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
  'features/autograb/components/AutograbPanel.vue',
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
