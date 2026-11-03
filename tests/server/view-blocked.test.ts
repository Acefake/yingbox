import { describe, expect, it, vi } from 'vitest'

import { openLibraryDb } from '../../src/main/library/db/database'
import { createSourceSessions } from '../../src/server/view/detail'
import { withoutHidden } from '../../src/server/view'
import { createPlayback, sqliteUserState } from '../../src/server/playback'
import { searchCards } from '../../src/server/view/search'
import type { SourceDeps } from '../../src/server/view/sources'
import { parseBlocked, setBlocked } from '../../src/shared/online/blocked-sites'

describe('屏蔽站点的规则', () => {
  it('读回的值只认字符串，去空去重；屏蔽与恢复保持幂等', () => {
    expect(parseBlocked(['甲', ' 乙 ', '', 3, null, '甲'])).toEqual([
      '甲',
      '乙',
    ])
    expect(parseBlocked('坏数据')).toEqual([])
    expect(setBlocked(['甲'], '乙', true)).toEqual(['甲', '乙'])
    expect(setBlocked(['甲', '乙'], '乙', true)).toEqual(['甲', '乙'])
    expect(setBlocked(['甲', '乙'], '甲', false)).toEqual(['乙'])
    expect(setBlocked(['甲'], '丙', false)).toEqual(['甲'])
    expect(setBlocked(['甲'], '  ', true)).toEqual(['甲'])
  })

  it('存进 user_state，重新读还在', () => {
    const state = sqliteUserState(openLibraryDb(':memory:'))
    const playback = createPlayback(state)
    expect(playback.blockedSites()).toEqual([])
    expect(playback.setSiteBlocked('站甲', true)).toEqual(['站甲'])
    expect(createPlayback(state).blockedSites()).toEqual(['站甲'])
    expect(playback.setSiteBlocked('站甲', false)).toEqual([])
  })
})

describe('屏蔽后选源与搜索都跳过', () => {
  const deps = (): SourceDeps => ({
    cmsSites: () => [
      {
        key: 'a',
        name: '站甲',
        api: 'https://a.example.com/api.php',
        detail: '',
      },
      {
        key: 'b',
        name: '站乙',
        api: 'https://b.example.com/api.php',
        detail: '',
      },
    ],
    pluginSites: async () => [],
    getJson: vi.fn(async (url: string) => {
      const u = new URL(url)
      if (u.searchParams.get('wd'))
        return {
          success: true as const,
          data: { list: [{ vod_id: 1, vod_name: '小城良方' }] },
        }
      return {
        success: true as const,
        data: {
          list: [
            {
              vod_id: 1,
              vod_name: '小城良方',
              vod_play_from: '线路',
              vod_play_url: `第1集$https://${u.hostname}/v/index.m3u8`,
            },
          ],
        },
      }
    }),
    vod: vi.fn(async () => ({ success: false as const, error: '无' })),
  })

  it('搜索不再请求被屏蔽的站点', async () => {
    const d = deps()
    const blocked = ['站乙']
    const cards = await searchCards(
      '小城良方',
      withoutHidden(d, () => new Set(blocked))
    )
    expect(cards[0].siteCount).toBe(1)
    const asked = (d.getJson as ReturnType<typeof vi.fn>).mock.calls.map(
      c => new URL(c[0]).hostname
    )
    expect(asked).not.toContain('b.example.com')
  })

  it('已有会话里的结果在屏蔽后立刻去掉，恢复后又回来', async () => {
    const blocked = new Set<string>()
    const sessions = createSourceSessions(
      deps(),
      Date.now,
      () => 's1',
      undefined,
      () => blocked
    )
    sessions.start('小城良方')
    await vi.waitFor(() => expect(sessions.get('s1')?.done).toBe(true))
    expect(
      sessions
        .get('s1')!
        .sites.map(s => s.siteName)
        .sort()
    ).toEqual(['站乙', '站甲'])
    blocked.add('站乙')
    expect(sessions.get('s1')!.sites.map(s => s.siteName)).toEqual(['站甲'])
    blocked.delete('站乙')
    expect(sessions.get('s1')!.sites).toHaveLength(2)
  })
})
