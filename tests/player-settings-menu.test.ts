import { describe, expect, it } from 'vitest'

import {
  SETTING_ORDER,
  audioChoices,
  choiceTooltip,
  danmakuChoices,
  orderSettings,
  qualityChoices,
  rateLabel,
  subtitleChoices,
} from '../src/renderer/src/features/player/settings-menu/menu-rules'

describe('齿轮设置菜单：一级列表顺序', () => {
  it('按 YouTube 的顺序：字幕、播放速度、画质、音轨、弹幕在前，其余在后', () => {
    expect(SETTING_ORDER.slice(0, 5)).toEqual([
      'ybSubtitles',
      'playbackRate',
      'ybQuality',
      'ybAudio',
      'ybDanmaku',
    ])
    const items = [
      { name: 'playbackRate' },
      { name: 'ybPlaybackInfo' },
      { name: 'ybSleep' },
      { name: 'custom-a' },
      { name: 'ybDanmaku' },
      { name: 'ybSubtitles' },
      { name: 'custom-b' },
    ]
    expect(orderSettings(items).map(i => i.name)).toEqual([
      'ybSubtitles',
      'playbackRate',
      'ybDanmaku',
      'ybSleep',
      'ybPlaybackInfo',
      'custom-a',
      'custom-b',
    ])
  })

  it('排序不改原数组', () => {
    const items = [{ name: 'ybSleep' }, { name: 'ybSubtitles' }]
    orderSettings(items)
    expect(items[0].name).toBe('ybSleep')
  })
})

describe('齿轮设置菜单：二级页面', () => {
  it('画质：少于两档不出现；自动在最前，按高度从高到低，当前档打勾', () => {
    expect(qualityChoices([{ height: 1080, bitrate: 1 }], -1)).toEqual([])
    const list = qualityChoices(
      [
        { height: 720, bitrate: 2 },
        { height: 1080, bitrate: 5 },
        { height: 480, bitrate: 1 },
      ],
      1
    )
    expect(list.map(c => c.html)).toEqual(['自动', '1080p', '720p', '480p'])
    expect(list.map(c => c.value)).toEqual(['-1', '1', '0', '2'])
    expect(list.filter(c => c.default).map(c => c.html)).toEqual(['1080p'])
    expect(choiceTooltip(list)).toBe('1080p')
    expect(
      choiceTooltip(
        qualityChoices(
          [
            { height: 720, bitrate: 2 },
            { height: 1080, bitrate: 5 },
          ],
          -1
        )
      )
    ).toBe('自动')
  })

  it('音轨：少于两条不出现；名称缺省用语言或序号', () => {
    expect(audioChoices([{ name: '国语' }], 0)).toEqual([])
    const list = audioChoices([{ name: '国语' }, { lang: 'en' }, {}], 1)
    expect(list.map(c => c.html)).toEqual(['国语', 'en', '音轨 3'])
    expect(choiceTooltip(list)).toBe('en')
  })

  it('字幕：关闭在最前，字幕轨居中，在线字幕 / AI 字幕入口在最后', () => {
    const tracks = [
      { name: '简体中文.srt', path: '/a.srt' },
      { name: 'English.srt', path: '/b.srt' },
    ]
    const shown = subtitleChoices(tracks, '/b.srt', true)
    expect(shown.map(c => c.value)).toEqual([
      'off',
      '/a.srt',
      '/b.srt',
      'panel',
    ])
    expect(shown.at(-1)!.html).toBe('在线字幕与 AI 字幕…')
    expect(choiceTooltip(shown)).toBe('English.srt')
    const hidden = subtitleChoices(tracks, '/b.srt', false)
    expect(choiceTooltip(hidden)).toBe('关闭')
    expect(subtitleChoices([], null, false).map(c => c.value)).toEqual([
      'off',
      'panel',
    ])
  })

  it('弹幕：开 / 关二选一，另有弹幕设置入口', () => {
    const on = danmakuChoices(true)
    expect(on.map(c => c.value)).toEqual(['on', 'off', 'panel'])
    expect(choiceTooltip(on)).toBe('开启')
    expect(choiceTooltip(danmakuChoices(false))).toBe('关闭')
  })

  it('播放速度标签：1 倍为「正常」', () => {
    expect(rateLabel(1)).toBe('正常')
    expect(rateLabel(1.5)).toBe('1.5')
    expect(rateLabel(0.25)).toBe('0.25')
  })
})
