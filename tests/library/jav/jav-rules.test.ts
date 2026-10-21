/**
 * 番号站点设置页的纯规则：站点行、开关、上下移动；文件夹描述标出番号库。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JAV_SETTINGS,
  JAV_SITES,
} from '../../../src/shared/library/ipc'
import {
  javSiteRows,
  moveJavSite,
  toggleJavSite,
} from '../../../src/renderer/src/features/library/settings/jav-rules'
import { folderDescription } from '../../../src/renderer/src/features/library/settings/settings-rules'

describe('番号站点设置规则', () => {
  it('站点行：名称、优先级、能否上下移', () => {
    const rows = javSiteRows(DEFAULT_JAV_SETTINGS)
    const last = JAV_SITES.length
    expect(rows.map(r => [r.id, r.name, r.rank])).toEqual(
      JAV_SITES.map((site, i) => [site.id, site.name, i + 1])
    )
    expect(rows[0]).toMatchObject({ id: 'javbus', canUp: false, canDown: true })
    expect(rows[1]).toMatchObject({ canUp: true, canDown: true })
    expect(rows[last - 1]).toMatchObject({
      id: JAV_SITES[last - 1].id,
      canUp: true,
      canDown: false,
    })
  })

  it('开关与移动返回新设置，不改原对象；越界原样返回', () => {
    const at = DEFAULT_JAV_SETTINGS.sites.findIndex(s => s.id === 'avbase')
    const off = toggleJavSite(DEFAULT_JAV_SETTINGS, 'avbase', false)
    expect(off.sites[at]).toEqual({ id: 'avbase', enabled: false })
    expect(DEFAULT_JAV_SETTINGS.sites[at].enabled).toBe(true)
    const ids = DEFAULT_JAV_SETTINGS.sites.map(s => s.id)
    const i = ids.indexOf('fc2')
    const moved = moveJavSite(DEFAULT_JAV_SETTINGS, 'fc2', -1)
    expect(moved.sites.map(s => s.id)).toEqual([
      ...ids.slice(0, i - 1),
      'fc2',
      ids[i - 1],
      ...ids.slice(i + 1),
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
