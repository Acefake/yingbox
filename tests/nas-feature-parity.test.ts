/** test-affected: repo-wide */
import { describe, expect, it } from 'vitest'
import { routes } from '../src/renderer/src/router/routers'
import { nasRoutes } from '../src/renderer/src/nas/routes'

describe('NAS 功能边界', () => {
  it('仅排除番号与 AV 路由，在线、片库、日历、直播、网盘保持一致', () => {
    expect(nasRoutes.map(route => route.path)).toEqual(
      routes
        .filter(route => route.path !== '/jav' && route.path !== '/av')
        .map(route => route.path)
    )
    expect(
      nasRoutes.some(
        route => 'meta' in route && 'adultOnly' in (route.meta ?? {})
      )
    ).toBe(false)
  })
})
