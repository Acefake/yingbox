import { describe, expect, it, vi } from 'vitest'

import { createSourceSessions } from '../../src/server/view/detail'
import { type ProbeDeps, createProber } from '../../src/server/view/probe'
import { sourceSites } from '../../src/server/view/sources'
import type { SourceDeps } from '../../src/server/view/sources'
import type { EpisodeGroup } from '../../src/shared/online/types'

const group = (siteName: string, host: string): EpisodeGroup => ({
  label: siteName,
  _siteName: siteName,
  _source: 'cms',
  hasDirect: true,
  episodes: [{ name: '第1集', url: `https://${host}/a/index.m3u8` }],
})

describe('源按测速排序（sourceSites）', () => {
  it('成功的按速度从快到慢在前，测速中其次，失败最后，最快的打标记', () => {
    const sites = sourceSites(
      [
        group('甲', 'a.example.com'),
        group('乙', 'b.example.com'),
        group('丙', 'c.example.com'),
        group('丁', 'd.example.com'),
      ],
      {
        甲: { status: 'fail' },
        乙: {
          status: 'ok',
          latencyMs: 300,
          speedBps: 1024 * 1024,
          height: 720,
        },
        丙: {
          status: 'ok',
          latencyMs: 800,
          speedBps: 4 * 1024 * 1024,
          height: 1080,
        },
      }
    )
    expect(sites.map(s => s.siteName)).toEqual(['丙', '乙', '丁', '甲'])
    expect(sites.map(s => s.status)).toEqual(['ok', 'ok', 'pending', 'fail'])
    expect(sites[0]).toMatchObject({
      resolution: '1080P',
      detail: '800 ms · 4.0 MB/s',
      fastest: true,
    })
    expect(sites[1].fastest).toBe(false)
    expect(sites[2].detail).toBe('测速中…')
    expect(sites[3].detail).toBe('超时或无法播放')
  })
})

describe('选源会话里的测速', () => {
  const sourceDeps = (): SourceDeps => ({
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
      // 详情：站内一条线路一集，地址按站点区分
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

  it('测完后站点按速度排序，done 之后 probing 仍为真直到测速结束', async () => {
    const speeds: Record<string, number> = {
      'a.example.com': 1024 * 1024,
      'b.example.com': 5 * 1024 * 1024,
    }
    const probeStream = vi.fn(async (url: string) => ({
      ok: true,
      latencyMs: 100,
      speedBps: speeds[new URL(url).hostname],
      height: 720,
    }))
    const deps: ProbeDeps = {
      playinfo: async () => null,
      resolvePage: async url => url,
      probeStream,
    }
    const sessions = createSourceSessions(
      sourceDeps(),
      Date.now,
      () => 's1',
      createProber(deps)
    )
    sessions.start('小城良方')
    await vi.waitFor(() => {
      const v = sessions.get('s1')
      expect(v?.done).toBe(true)
      expect(v?.probing).toBe(false)
      expect(v?.sites).toHaveLength(2)
    })
    const sites = sessions.get('s1')!.sites
    expect(sites.map(s => s.siteName)).toEqual(['站乙', '站甲'])
    expect(sites[0]).toMatchObject({ status: 'ok', fastest: true })
    expect(probeStream).toHaveBeenCalledTimes(2)
  })
})
