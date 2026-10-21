/**
 * 番号站点设置页的纯规则：站点行、开关、上下移动；文件夹描述标出番号库。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_JAV_SETTINGS } from '../../../src/shared/library/ipc'
import {
  javSiteRows,
  moveJavSite,
  toggleJavSite,
} from '../../../src/renderer/src/features/library/settings/jav-rules'
import { folderDescription } from '../../../src/renderer/src/features/library/settings/settings-rules'

describe('番号站点设置规则', () => {
  it('站点行：名称、优先级、能否上下移', () => {
    const rows = javSiteRows(DEFAULT_JAV_SETTINGS)
    // 站点会陆续增加：只核对前几个与首尾的上下移规则
    expect(
      rows.slice(0, 3).map(r => [r.id, r.name, r.rank, r.canUp, r.canDown])
    ).toEqual([
      ['javbus', 'JavBus', 1, false, true],
      ['avbase', 'AVBase', 2, true, true],
      ['fc2', 'FC2', 3, true, rows.length > 3],
    ])
    expect(rows.at(-1)).toMatchObject({ rank: rows.length, canDown: false })
  })

  it('开关与移动返回新设置，不改原对象；越界原样返回', () => {
    const off = toggleJavSite(DEFAULT_JAV_SETTINGS, 'avbase', false)
    expect(off.sites[1]).toEqual({ id: 'avbase', enabled: false })
    expect(DEFAULT_JAV_SETTINGS.sites[1].enabled).toBe(true)
    const moved = moveJavSite(DEFAULT_JAV_SETTINGS, 'fc2', -1)
    expect(moved.sites.slice(0, 3).map(s => s.id)).toEqual([
      'javbus',
      'fc2',
      'avbase',
    ])
    expect(moveJavSite(DEFAULT_JAV_SETTINGS, 'javbus', -1)).toBe(
      DEFAULT_JAV_SETTINGS
    )
  })

  it('文件夹描述：番号库带「番号」前缀', () => {
    const lib = { root: '/av', lastScanAt: null }
    expect(folderDescription({ ...lib, source: 'jav' })).toBe(
      '番号 · /av · 尚未扫描'
    )
    expect(folderDescription({ ...lib, source: 'tmdb' })).toBe('/av · 尚未扫描')
  })
})
