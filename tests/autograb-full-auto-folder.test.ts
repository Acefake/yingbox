import { type Mock, describe, expect, it, vi } from 'vitest'

import { needsFolderForAuto } from '../src/renderer/src/features/autograb/autograb-rules'
import {
  type FullAutoFolder,
  useFullAutoFolder,
} from '../src/renderer/src/features/autograb/use-full-auto-folder'
import { usePolicyFolder } from '../src/renderer/src/features/autograb/use-policy-folder'
import { DEFAULT_PREFS } from '../src/shared/contract/autograb-prefs'
import { type GrabMode, policyOf } from '../src/shared/contract/grab-policy'
import type {
  AutograbOverview,
  AutograbSeries,
} from '../src/shared/contract/autograb'

const series: AutograbSeries = {
  seriesId: 7,
  title: '某剧',
  mode: 'off',
  effectiveMode: 'off',
  confirmFirst: 1,
  cid: '',
  cidName: '',
  confirmed: 0,
  prefs: {},
}

function overviewWith(
  defaultCid: string,
  policyMode: GrabMode = 'off'
): AutograbOverview {
  return {
    policy: { ...policyOf(undefined, 'tv'), mode: policyMode },
    enabled: true,
    pausedUntil: null,
    pauseReason: null,
    spacePaused: null,
    prefs: DEFAULT_PREFS,
    ready: { loggedIn: true, pansou: true },
    today: { snaps: 0, receives: 0 },
    series: [series],
    episodes: [],
    running: false,
    defaultFolder: { cid: defaultCid, name: defaultCid === '0' ? '' : '剧集' },
  }
}

function setup(
  defaultCid = '0',
  policyMode: GrabMode = 'off'
): {
  fa: FullAutoFolder
  setSeries: Mock<(...args: unknown[]) => Promise<boolean>>
  warn: Mock<(text: string) => void>
} {
  const setSeries = vi.fn(async (..._args: unknown[]) => true)
  const warn = vi.fn((_text: string) => {})
  const fa = useFullAutoFolder({
    overview: () => overviewWith(defaultCid, policyMode),
    setSeries,
    warn,
  })
  return { fa, setSeries, warn }
}

describe('切全自动前补选文件夹', () => {
  it('按实际解析的目录判断：单独选的 > 剧集默认目录，根目录 / 非法 cid 都算没有', () => {
    expect(needsFolderForAuto({ cid: '' }, { cid: '0', name: '' })).toBe(true)
    expect(needsFolderForAuto({ cid: '' }, { cid: 'x', name: '' })).toBe(true)
    expect(needsFolderForAuto({ cid: '' }, { cid: '42', name: '剧集' })).toBe(
      false
    )
    expect(needsFolderForAuto({ cid: '9' }, { cid: '0', name: '' })).toBe(false)
  })

  it('不追 → 全自动且没有文件夹：先打开选择，不发请求；选完存文件夹并切到全自动', async () => {
    const { fa, setSeries } = setup()
    await fa.changeMode(series, 'auto')
    expect(fa.picking.value).toBe(7)
    expect(setSeries).not.toHaveBeenCalled()

    await fa.pick({ cid: '123', name: '追更' })
    expect(setSeries).toHaveBeenCalledWith(7, {
      cid: '123',
      cidName: '追更',
      mode: 'auto',
    })
    expect(fa.picking.value).toBeNull()
  })

  it('取消：关掉选择，什么都不改（仍不追）', async () => {
    const { fa, setSeries } = setup()
    await fa.changeMode(series, 'auto')
    fa.cancel()
    expect(fa.picking.value).toBeNull()
    expect(setSeries).not.toHaveBeenCalled()
    await fa.pick({ cid: '123', name: '追更' })
    expect(setSeries).not.toHaveBeenCalled()
  })

  it('选了根目录：提示换一个，选择保持打开', async () => {
    const { fa, setSeries, warn } = setup()
    await fa.changeMode(series, 'auto')
    await fa.pick({ cid: '0', name: '' })
    expect(warn).toHaveBeenCalledOnce()
    expect(setSeries).not.toHaveBeenCalled()
    expect(fa.picking.value).toBe(7)
  })

  it('保存失败时选择保持打开', async () => {
    const { fa, setSeries } = setup()
    setSeries.mockResolvedValueOnce(false)
    await fa.changeMode(series, 'auto')
    await fa.pick({ cid: '123', name: '追更' })
    expect(fa.picking.value).toBe(7)
  })

  it('有剧集默认目录：直接切全自动，不弹选择', async () => {
    const { fa, setSeries } = setup('42')
    await fa.changeMode(series, 'auto')
    expect(fa.picking.value).toBeNull()
    expect(setSeries).toHaveBeenCalledWith(7, { mode: 'auto' })
  })

  it('其他模式照常保存，并收起这部剧的选择', async () => {
    const { fa, setSeries } = setup()
    await fa.changeMode(series, 'auto')
    await fa.changeMode(series, 'confirm')
    expect(fa.picking.value).toBeNull()
    expect(setSeries).toHaveBeenCalledWith(7, { mode: 'confirm' })
  })
})

describe('跟随全局与全局切全自动', () => {
  it('全局是全自动时改成「跟随」也要先选文件夹，选好后存文件夹并跟随', async () => {
    const { fa, setSeries } = setup('0', 'auto')
    await fa.changeMode(series, 'inherit')
    expect(fa.picking.value).toBe(7)
    expect(setSeries).not.toHaveBeenCalled()
    await fa.pick({ cid: '55', name: '某剧' })
    expect(setSeries).toHaveBeenCalledWith(7, {
      cid: '55',
      cidName: '某剧',
      mode: 'inherit',
    })
  })

  it('全局全自动而默认目录是根目录：先选默认目录，存好再切；根目录不行；取消不改', async () => {
    const setMode = vi.fn(async (_mode: GrabMode) => true)
    const saved: string[] = []
    const warn = vi.fn((_text: string) => {})
    const pf = usePolicyFolder({
      targetCid: () => '0',
      setMode,
      saveDefaultFolder: async folder => void saved.push(folder.cid),
      warn,
    })
    await pf.changeMode('confirm')
    expect(setMode).toHaveBeenLastCalledWith('confirm')
    await pf.changeMode('auto')
    expect(pf.picking.value).toBe(true)
    expect(setMode).toHaveBeenCalledTimes(1)
    await pf.pick({ cid: '0', name: '' })
    expect(warn).toHaveBeenCalled()
    await pf.pick({ cid: '66', name: '剧集' })
    expect(saved).toEqual(['66'])
    expect(setMode).toHaveBeenLastCalledWith('auto')
    expect(pf.picking.value).toBe(false)
    await pf.changeMode('auto')
    pf.cancel()
    expect(pf.picking.value).toBe(false)
  })

  it('默认目录不是根目录：直接切全自动', async () => {
    const setMode = vi.fn(async (_mode: GrabMode) => true)
    const pf = usePolicyFolder({
      targetCid: () => '66',
      setMode,
      saveDefaultFolder: async () => {},
      warn: () => {},
    })
    await pf.changeMode('auto')
    expect(pf.picking.value).toBe(false)
    expect(setMode).toHaveBeenCalledWith('auto')
  })
})
