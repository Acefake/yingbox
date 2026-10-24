/**
 * 在线自动选源：测速缓存与排序、手动选源记录、换源规则、引擎测速（m3u8 清单解析与采样）。
 */
import { describe, expect, it } from 'vitest'
import {
  PICK_MAX,
  PROBE_CACHE_MAX,
  PROBE_TTL_MS,
  type ProbeCacheEntry,
  type SourceProbe,
  fastestSite,
  findPick,
  firstEpisode,
  formatLatency,
  formatSpeed,
  freshProbe,
  isProbeCacheEntry,
  isSourcePick,
  mergePick,
  mergeProbeCache,
  preferredSite,
  probeKey,
  rankSites,
  resolutionLabel,
} from '../src/renderer/src/features/online/utils/auto-source'
import {
  formatClock,
  isStalled,
  nextFallbackIndex,
  sourceName,
  switchNotice,
  targetName,
} from '../src/renderer/src/features/player/utils/source-switch'
import {
  parseM3u8,
  pickVariant,
  probeStream,
} from '../src/engine/online/stream-probe'
import type { NetClient } from '../src/shared/net/client'
import { defaultValues, parseSetting } from '../src/shared/settings/schema'

const ok = (speedBps: number, latencyMs = 100): SourceProbe => ({
  status: 'ok',
  speedBps,
  latencyMs,
})
const site = (siteName: string): { siteName: string } => ({ siteName })

describe('测速缓存', () => {
  it('缓存键：http(s) 地址按域名，其它按站点名', () => {
    expect(probeKey('量子', 'https://CDN.Example.com/a/index.m3u8')).toBe(
      'host:cdn.example.com'
    )
    expect(probeKey('插件', '/play/123')).toBe('site:插件')
    expect(probeKey('插件', 'ftp://x/y')).toBe('site:插件')
  })

  it('30 分钟内命中，过期、pending、未来时间都不算', () => {
    const now = 10 * PROBE_TTL_MS
    const entries: ProbeCacheEntry[] = [
      { key: 'a', probe: ok(1), at: now - PROBE_TTL_MS + 1 },
      { key: 'b', probe: ok(1), at: now - PROBE_TTL_MS },
      { key: 'c', probe: { status: 'pending' }, at: now },
      { key: 'd', probe: { status: 'fail' }, at: now + 1000 },
    ]
    expect(freshProbe(entries, 'a', now)).toEqual(ok(1))
    expect(freshProbe(entries, 'b', now)).toBeUndefined()
    expect(freshProbe(entries, 'c', now)).toBeUndefined()
    expect(freshProbe(entries, 'd', now)).toBeUndefined()
    expect(freshProbe(entries, 'x', now)).toBeUndefined()
  })

  it('写入：新的在前，去掉同键与过期，有上限', () => {
    const now = 5 * PROBE_TTL_MS
    const merged = mergeProbeCache(
      [
        { key: 'a', probe: ok(1), at: now - 10 },
        { key: 'old', probe: ok(1), at: now - PROBE_TTL_MS - 1 },
        { key: 'b', probe: { status: 'fail' }, at: now - 5 },
      ],
      { key: 'a', probe: ok(2), at: now },
      now
    )
    expect(merged.map(e => [e.key, e.probe.speedBps])).toEqual([
      ['a', 2],
      ['b', undefined],
    ])
    const many = Array.from({ length: PROBE_CACHE_MAX + 20 }, (_, i) => ({
      key: `k${i}`,
      probe: ok(i),
      at: now,
    }))
    expect(
      mergeProbeCache(many, { key: 'n', probe: ok(1), at: now }, now)
    ).toHaveLength(PROBE_CACHE_MAX)
  })

  it('读回校验：只认 ok / fail 的完整条目', () => {
    expect(isProbeCacheEntry({ key: 'a', at: 1, probe: ok(1) })).toBe(true)
    expect(
      isProbeCacheEntry({ key: 'a', at: 1, probe: { status: 'pending' } })
    ).toBe(false)
    expect(isProbeCacheEntry({ key: 'a', probe: ok(1) })).toBe(false)
    expect(isProbeCacheEntry(null)).toBe(false)
  })
})

describe('排序与默认源', () => {
  const sites = ['A', 'B', 'C', 'D', 'E'].map(site)
  const probes: Record<string, SourceProbe> = {
    A: { status: 'fail' },
    B: ok(1_000_000, 300),
    C: { status: 'pending' },
    D: ok(5_000_000, 80),
    E: ok(1_000_000, 100),
  }

  it('成功按速度降序（同速延迟低在前）→ 测速中 → 失败最后', () => {
    expect(rankSites(sites, probes).map(s => s.siteName)).toEqual([
      'D',
      'E',
      'B',
      'C',
      'A',
    ])
    // 没有任何结果时保持原顺序
    expect(rankSites(sites, {}).map(s => s.siteName)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
  })

  it('最快源与默认源：手动选过且在列表里的优先', () => {
    expect(fastestSite(sites, probes)).toBe('D')
    expect(fastestSite(sites, { A: { status: 'fail' } })).toBe('')
    expect(preferredSite(sites, probes, 'B')).toBe('B')
    expect(preferredSite(sites, probes, '不在列表')).toBe('D')
    expect(preferredSite(sites, probes, '')).toBe('D')
  })

  it('第 1 集：取第一条有剧集的线路', () => {
    expect(
      firstEpisode([
        { label: 'x', episodes: [], hasDirect: false },
        {
          label: 'y',
          hasDirect: true,
          episodes: [
            { name: '1', url: '' },
            { name: '2', url: 'u2', ext: { id: 2 } },
          ],
        },
      ])
    ).toEqual({ url: 'u2', ext: { id: 2 } })
    expect(firstEpisode([])).toBeUndefined()
  })
})

describe('手动选源记录', () => {
  it('同片只留最新一条，新的在前，有上限', () => {
    let picks = mergePick([], { film: 'a', site: 'X', at: 1 })
    picks = mergePick(picks, { film: 'b', site: 'Y', at: 2 })
    picks = mergePick(picks, { film: 'a', site: 'Z', at: 3 })
    expect(picks.map(p => `${p.film}:${p.site}`)).toEqual(['a:Z', 'b:Y'])
    expect(findPick(picks, 'a')).toBe('Z')
    expect(findPick(picks, 'c')).toBe('')
    expect(findPick(picks, '')).toBe('')
    const many = Array.from({ length: PICK_MAX + 5 }, (_, i) => ({
      film: `f${i}`,
      site: 's',
      at: i,
    }))
    expect(mergePick(many, { film: 'n', site: 's', at: 0 })).toHaveLength(
      PICK_MAX
    )
    expect(isSourcePick({ film: 'a', site: 'b', at: 1 })).toBe(true)
    expect(isSourcePick({ film: 'a', site: 1, at: 1 })).toBe(false)
  })
})

describe('展示文案', () => {
  it('速度 / 延迟 / 分辨率', () => {
    expect(formatSpeed(12.4 * 1024 * 1024)).toBe('12.4 MB/s')
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s')
    expect(formatSpeed(0)).toBe('—')
    expect(formatLatency(82.4)).toBe('82 ms')
    expect(formatLatency(undefined)).toBe('—')
    expect(resolutionLabel(1080)).toBe('1080P')
    expect(resolutionLabel(1036)).toBe('1080P')
    expect(resolutionLabel(720)).toBe('720P')
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(undefined)).toBe('')
  })
})

describe('播放中换源', () => {
  it('下一条备用源：主源 → 0 → 1 … 用完返回 -1', () => {
    expect(nextFallbackIndex(-1, 2)).toBe(0)
    expect(nextFallbackIndex(0, 2)).toBe(1)
    expect(nextFallbackIndex(1, 2)).toBe(-1)
    expect(nextFallbackIndex(-1, 0)).toBe(-1)
  })

  it('卡顿判定：缓冲持续 ≥ N 秒', () => {
    expect(isStalled(1000, 5999, 5)).toBe(false)
    expect(isStalled(1000, 6000, 5)).toBe(true)
    expect(isStalled(0, 99999, 5)).toBe(false)
    expect(isStalled(1000, 99999, 0)).toBe(false)
  })

  it('提示文案：「X 卡顿，已切换到 Y · 从 mm:ss 继续」', () => {
    const from = { url: 'a', name: '第1集', siteName: '量子资源' }
    const to = { url: 'b', name: '非凡资源 · 线路1', siteName: '非凡资源' }
    const sameSite = { url: 'c', name: '量子资源 · 备用', siteName: '量子资源' }
    expect(sourceName(from)).toBe('量子资源')
    expect(sourceName({ url: 'x' })).toBe('当前源')
    expect(targetName(from, to)).toBe('非凡资源')
    expect(targetName(from, sameSite)).toBe('量子资源 · 备用')
    expect(formatClock(23 * 60 + 14)).toBe('23:14')
    expect(formatClock(3600 + 65)).toBe('1:01:05')
    expect(switchNotice('stall', '量子资源', '非凡资源', 1394.7)).toBe(
      '量子资源 卡顿，已切换到 非凡资源 · 从 23:14 继续'
    )
    expect(switchNotice('error', 'A', 'B', 0)).toBe('A 播放失败，已切换到 B')
  })

  it('设置项：默认开启、5 秒，秒数有范围', () => {
    expect(defaultValues()['online.autoSwitchSource']).toBe(true)
    expect(defaultValues()['online.stallSeconds']).toBe(5)
    expect(parseSetting('online.stallSeconds', 1)).toBeUndefined()
    expect(parseSetting('online.stallSeconds', 8)).toEqual({
      key: 'online.stallSeconds',
      value: 8,
    })
  })
})

describe('引擎测速', () => {
  it('解析主清单 / 媒体清单', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
      '720/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080',
      '1080/index.m3u8',
    ].join('\n')
    const parsed = parseM3u8(master)
    expect(parsed.firstSegment).toBeUndefined()
    expect(pickVariant(parsed.variants)).toEqual({
      uri: '1080/index.m3u8',
      bandwidth: 2000000,
      height: 1080,
    })
    expect(
      parseM3u8('#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nseg1.ts')
        .firstSegment
    ).toBe('seg0.ts')
  })

  /** 按地址返回固定内容的假网络客户端 */
  const fakeNet = (
    routes: Record<string, { status?: number; body: string; type?: string }>
  ): { net: NetClient; calls: string[] } => {
    const calls: string[] = []
    const net = {
      open: async (url: string) => {
        calls.push(url)
        const route = routes[url]
        if (!route) throw new Error('连接失败')
        return {
          url,
          response: new Response(route.body, {
            status: route.status ?? 200,
            headers: route.type ? { 'content-type': route.type } : {},
          }),
        }
      },
    } as unknown as NetClient
    return { net, calls }
  }

  it('主清单 → 最高码率子清单 → 首个分片采样，带分辨率', async () => {
    const { net, calls } = fakeNet({
      'https://cdn.test/v/index.m3u8': {
        body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080\nhd/index.m3u8',
      },
      'https://cdn.test/v/hd/index.m3u8': {
        body: '#EXTM3U\n#EXTINF:4,\n/seg/0.ts\n',
      },
      'https://cdn.test/seg/0.ts': { body: 'x'.repeat(4096) },
    })
    const result = await probeStream(net, 'https://cdn.test/v/index.m3u8', {
      sampleMs: 50,
    })
    expect(calls).toEqual([
      'https://cdn.test/v/index.m3u8',
      'https://cdn.test/v/hd/index.m3u8',
      'https://cdn.test/seg/0.ts',
    ])
    expect(result.ok).toBe(true)
    expect(result.height).toBe(1080)
    expect(result.speedBps).toBeGreaterThan(0)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('mp4 直链直接采样；HTTP 错误、连接失败、空清单都返回 ok: false', async () => {
    const { net } = fakeNet({
      'https://a.test/v.mp4': { body: 'y'.repeat(2048), type: 'video/mp4' },
      'https://a.test/404.m3u8': { status: 404, body: '' },
      'https://a.test/empty.m3u8': { body: '#EXTM3U\n' },
    })
    const mp4 = await probeStream(net, 'https://a.test/v.mp4', { sampleMs: 50 })
    expect(mp4.ok).toBe(true)
    expect(mp4.height).toBeUndefined()
    expect(await probeStream(net, 'https://a.test/404.m3u8')).toMatchObject({
      ok: false,
      error: 'HTTP 404',
    })
    expect((await probeStream(net, 'https://a.test/empty.m3u8')).ok).toBe(false)
    expect(await probeStream(net, 'https://a.test/none.m3u8')).toMatchObject({
      ok: false,
      error: '连接失败',
    })
  })
})
