/**
 * 转存目标文件夹：解析优先级（单独指定 > 类型默认目录 > 原转存目标）、老配置不迁移也落到原文件夹、
 * 契约参数校验（pan115.receive / offline.add 的 folder）、网盘页的选择规则与最近使用列表。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContractError } from '../../src/shared/contract/define'
import { offline } from '../../src/shared/contract/offline'
import { pan115, targetFolderArg } from '../../src/shared/contract/pan115'
import {
  type TargetSettings,
  defaultFolder,
  folderLabel,
  hasKindDefault,
  normalizeCid,
  readTargetSettings,
  resolveTarget,
} from '../../src/shared/netdisk/target-folder'
import { defaultValues } from '../../src/shared/settings/schema'
import {
  MAX_RECENT_FOLDERS,
  RECENT_FOLDERS_KEY,
  pushRecentFolder,
  readRecentFolders,
  rememberRecentFolder,
} from '../../src/renderer/src/features/netdisk/utils/recent-folders'
import {
  choiceFolder,
  kindPresets,
} from '../../src/renderer/src/features/netdisk/utils/transfer-target'

/** 只设过一个转存目标的老配置 */
const LEGACY: TargetSettings = {
  'pan115.targetCid': '100',
  'pan115.targetName': '影视',
  'pan115.movieCid': '',
  'pan115.movieName': '',
  'pan115.tvCid': '',
  'pan115.tvName': '',
}

describe('转存目标解析', () => {
  it('老配置（只有原转存目标）：电影 / 剧集默认目录都沿用它', () => {
    expect(defaultFolder('movie', LEGACY)).toEqual({ cid: '100', name: '影视' })
    expect(defaultFolder('tv', LEGACY)).toEqual({ cid: '100', name: '影视' })
    expect(hasKindDefault('movie', LEGACY)).toBe(false)
  })

  it('新装默认值：都落到根目录', () => {
    const settings = readTargetSettings(key => defaultValues()[key])
    expect(defaultFolder('tv', settings)).toEqual({ cid: '0', name: '' })
    expect(folderLabel(defaultFolder('movie', settings))).toBe('根目录')
  })

  it('优先级：单独指定 > 类型默认目录 > 原转存目标', () => {
    const settings = {
      ...LEGACY,
      'pan115.tvCid': '200',
      'pan115.tvName': '剧集',
    }
    expect(resolveTarget({ cid: '300', name: '繁花' }, 'tv', settings)).toEqual(
      { cid: '300', name: '繁花' }
    )
    expect(resolveTarget(null, 'tv', settings)).toEqual({
      cid: '200',
      name: '剧集',
    })
    expect(resolveTarget({ cid: '', name: '' }, 'tv', settings).cid).toBe('200')
    // 电影没单独设：沿用原转存目标；类型未知按电影
    expect(resolveTarget(null, 'movie', settings).cid).toBe('100')
    expect(resolveTarget(null, null, settings).cid).toBe('100')
  })

  it('类型默认目录显式设成根目录（"0"）时就是根目录，不再沿用原转存目标', () => {
    const settings = { ...LEGACY, 'pan115.movieCid': '0' }
    expect(defaultFolder('movie', settings)).toEqual({ cid: '0', name: '' })
  })

  it('乱填的 cid 当根目录', () => {
    expect(normalizeCid('abc')).toBe('0')
    expect(normalizeCid('')).toBe('0')
    expect(normalizeCid(undefined)).toBe('0')
    expect(normalizeCid('42')).toBe('42')
    expect(folderLabel({ cid: '7', name: '' })).toBe('文件夹 7')
  })
})

describe('契约参数 folder', () => {
  it('不传 / null 为 null，cid 必须是数字，名字截到 500 字', () => {
    expect(targetFolderArg(undefined)).toBeNull()
    expect(targetFolderArg(null)).toBeNull()
    expect(() => targetFolderArg({ cid: '../1' })).toThrow(ContractError)
    expect(() => targetFolderArg('42')).toThrow(ContractError)
    expect(
      targetFolderArg({ cid: '42', name: 'x'.repeat(600) })?.name
    ).toHaveLength(500)
    expect(targetFolderArg({ cid: '42' })).toEqual({ cid: '42', name: '' })
  })

  it('pan115.receive 与 offline.add 解析第三 / 第二个参数', () => {
    expect(pan115.calls.receive.parse(['u', 'p'])).toEqual(['u', 'p', null])
    expect(
      pan115.calls.receive.parse(['u', 'p', { cid: '9', name: '电影' }])
    ).toEqual(['u', 'p', { cid: '9', name: '电影' }])
    const link = `magnet:?xt=urn:btih:${'a'.repeat(40)}`
    expect(offline.calls.add.parse([[link], { cid: '5', name: '剧' }])).toEqual(
      [[link], { cid: '5', name: '剧' }]
    )
    expect(offline.calls.add.parse([[link]])).toEqual([[link], null])
  })
})

describe('网盘页的转存目标选择', () => {
  const settings = { ...LEGACY, 'pan115.tvCid': '200', 'pan115.tvName': '剧集' }

  it('没另选：按命中类型预选，没对上按电影', () => {
    expect(choiceFolder(null, 'tv', settings)).toEqual({
      folder: { cid: '200', name: '剧集' },
      active: 'tv',
    })
    expect(choiceFolder(null, null, settings)).toEqual({
      folder: { cid: '100', name: '影视' },
      active: 'movie',
    })
  })

  it('另选默认目录或具体文件夹时以选择为准', () => {
    expect(choiceFolder({ kind: 'movie' }, 'tv', settings).folder.cid).toBe(
      '100'
    )
    expect(
      choiceFolder({ folder: { cid: '9', name: '纪录片' } }, 'tv', settings)
    ).toEqual({ folder: { cid: '9', name: '纪录片' }, active: null })
  })

  it('面板里的默认目录：电影、剧集各一项，带生效的文件夹', () => {
    expect(kindPresets(settings).map(p => [p.key, p.folder.cid])).toEqual([
      ['movie', '100'],
      ['tv', '200'],
    ])
  })
})

describe('最近使用的文件夹', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** 内存版 localStorage */
  function stubStorage(
    initial: Record<string, string> = {}
  ): Map<string, string> {
    const data = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    })
    return data
  }

  it('新用的排最前，同一 cid 只留一条，最多 5 个', () => {
    let list = pushRecentFolder([], { cid: '1', name: 'a' })
    for (const cid of ['2', '3', '4', '5', '6'])
      list = pushRecentFolder(list, { cid, name: cid })
    expect(list.map(f => f.cid)).toEqual(['6', '5', '4', '3', '2'])
    list = pushRecentFolder(list, { cid: '4', name: '改名' })
    expect(list[0]).toEqual({ cid: '4', name: '改名' })
    expect(list).toHaveLength(MAX_RECENT_FOLDERS)
  })

  it('经 utils/storage 读写；坏条目丢掉', () => {
    const data = stubStorage({
      [RECENT_FOLDERS_KEY]: JSON.stringify([
        { cid: '1', name: '电影' },
        { cid: 'x', name: '坏' },
        null,
        { cid: '2' },
      ]),
    })
    expect(readRecentFolders()).toEqual([{ cid: '1', name: '电影' }])
    rememberRecentFolder({ cid: '3', name: '剧集' })
    expect(JSON.parse(data.get(RECENT_FOLDERS_KEY)!)).toEqual([
      { cid: '3', name: '剧集' },
      { cid: '1', name: '电影' },
    ])
  })

  it('没有 localStorage 时读为空、写不抛', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readRecentFolders()).toEqual([])
    expect(rememberRecentFolder({ cid: '1', name: '' })).toEqual([
      { cid: '1', name: '' },
    ])
  })
})
