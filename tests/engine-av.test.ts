import { describe, expect, it, vi } from 'vitest'
import { type NetClient, createNetClient } from '../src/shared/net/client'
import {
  ResolveError,
  extractStream,
  isMediaUrl,
  listingUrl,
  pageUrl,
  parseCatalog,
  resolveStream,
} from '../src/engine/av/missav'
import { createAvHandlers } from '../src/engine/av'
import { refererFor } from '../src/main/media-headers'
import type { EngineContext } from '../src/engine/rpc'

const lookup = async (): Promise<{ address: string }[]> => [
  { address: '93.184.216.34' },
]
const net = (routes: Record<string, () => Response>): NetClient =>
  createNetClient({
    lookup,
    fetch: async url =>
      (routes[url] ?? (() => new Response('nf', { status: 404 })))(),
  })

const UUID = '12345678-1234-abcd-5678-123456789abc'
const PACKED = `m3u8|${UUID.split('-').reverse().join('|')}|com|surrit|https|video`
const CATALOG = `
  <div class="thumbnail group">
    <a href="https://missav.ai/cn/abp-001"><img data-src="https://fourhoi.com/abp-001/cover-t.jpg"></a>
    <span class="absolute">1:02:03</span>
    <a class="text-secondary group-hover:text-primary" href="https://missav.ai/cn/abp-001">ABP-001 Sample &amp; more</a>
  </div>
  <div class="thumbnail group"><a href="https://missav.ai/cn/new">分类链接不算</a></div>
  <a href="https://missav.ai/cn/new?page=2" rel="next">next</a>`

describe('MissAV 纯解析（移植自 test_missav_resolver.py）', () => {
  it('番号与链接规范化；拒绝非 MissAV / 内网 / 带账号 / 非 443 端口 / 空输入', () => {
    expect(pageUrl('AKDL-331')).toBe('https://missav.ai/cn/akdl-331')
    expect(pageUrl('https://missav.ws/cn/test#player')).toBe(
      'https://missav.ws/cn/test'
    )
    for (const bad of [
      'https://127.0.0.1/a',
      'https://missav.ai.evil.test/a',
      'file:///a',
      'https://user:pass@missav.ai/a',
      'https://missav.ai:999/a',
      '',
    ])
      expect(() => pageUrl(bad), bad).toThrow(ResolveError)
  })

  it('目录地址：分类、页码、排序都在白名单内', () => {
    expect(listingUrl('new', 1, 'latest')).toBe('https://missav.ai/cn/new')
    expect(listingUrl('chinese-subtitle', 2, 'hot')).toBe(
      'https://missav.ai/cn/chinese-subtitle?page=2&sort=monthly_views'
    )
    expect(() => listingUrl('genres', 1, 'latest')).toThrow(ResolveError)
    expect(() => listingUrl('new', 0, 'latest')).toThrow(ResolveError)
    expect(() => listingUrl('new', 1, 'score')).toThrow(ResolveError)
  })

  it('目录解析：番号、标题（解实体）、封面、时长、是否有下一页；分类链接被跳过', () => {
    expect(parseCatalog(CATALOG)).toEqual({
      hasNext: true,
      items: [
        {
          code: 'abp-001',
          title: 'ABP-001 Sample & more',
          poster: 'https://fourhoi.com/abp-001/cover-t.jpg',
          duration: '1:02:03',
        },
      ],
    })
  })

  it('播放地址：打包 UUID、转义直链；找不到抛 STREAM_NOT_FOUND', () => {
    expect(extractStream(PACKED)).toBe(
      `https://surrit.com/${UUID}/playlist.m3u8`
    )
    expect(
      extractStream(
        'source="https:\\/\\/surrit.com/id/playlist.m3u8?token=abc&amp;x=1"'
      )
    ).toBe('https://surrit.com/id/playlist.m3u8?token=abc&x=1')
    expect(() => extractStream('<html>No source</html>')).toThrow(/视频流/)
    expect(isMediaUrl('https://surrit.com.evil.test/a.m3u8')).toBe(false)
  })
})

describe('MissAV 解析流程', () => {
  it('番号依次尝试原页、中文字幕版；404 跳过', async () => {
    const n = net({
      'https://missav.ai/cn/abp-001': () =>
        new Response('gone', { status: 404 }),
      'https://missav.ai/cn/abp-001-chinese-subtitle': () =>
        new Response(PACKED),
    })
    const stream = await resolveStream(
      { net: n, browserFetch: async () => '' },
      'ABP-001'
    )
    expect(stream).toEqual({
      url: `https://surrit.com/${UUID}/playlist.m3u8`,
      title: 'MissAV · abp-001-chinese-subtitle',
      input: 'ABP-001',
    })
  })

  it('403 / 挑战页改用浏览器代抓；代抓失败给出验证提示', async () => {
    const n = net({
      'https://missav.ai/cn/abc-1': () =>
        new Response('<title>Just a moment</title>', { status: 403 }),
    })
    const browserFetch = vi.fn(async () => PACKED)
    await expect(
      resolveStream({ net: n, browserFetch }, 'https://missav.ai/cn/abc-1')
    ).resolves.toMatchObject({
      url: `https://surrit.com/${UUID}/playlist.m3u8`,
    })
    // 只要原始 HTML，不声明等待时长：主进程用默认挑战时限，过过挑战的主机走会话快路径
    expect(browserFetch).toHaveBeenCalledWith('https://missav.ai/cn/abc-1')
    await expect(
      resolveStream(
        { net: n, browserFetch: async () => '' },
        'https://missav.ai/cn/abc-1'
      )
    ).rejects.toMatchObject({ code: 'SITE_VERIFICATION_REQUIRED' })
  })

  it('页面重定向出 MissAV 域即拒绝', async () => {
    const n = net({
      'https://missav.ai/cn/abc-1': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test/x' },
        }),
    })
    await expect(
      resolveStream(
        { net: n, browserFetch: async () => '' },
        'https://missav.ai/cn/abc-1'
      )
    ).rejects.toThrow('不允许访问')
  })

  it('目录被挑战时经宿主 browserFetch 代抓，只传地址', async () => {
    const n = net({
      'https://missav.ai/cn/new': () =>
        new Response('<title>Just a moment</title>', { status: 403 }),
    })
    const host = vi.fn(async () => CATALOG)
    const ctx = { host, emit: () => {} } as unknown as EngineContext
    const page = await createAvHandlers(n).list(ctx, 'new', 1, 'latest')
    expect(page.items[0]).toMatchObject({ code: 'abp-001' })
    expect(host.mock.calls).toEqual([
      ['browserFetch', 'https://missav.ai/cn/new'],
    ])
  })

  it('目录 2 分钟内命中缓存', async () => {
    let calls = 0
    const n = net({
      'https://missav.ai/cn/new': () => {
        calls++
        return new Response(CATALOG)
      },
    })
    let clock = 0
    const handlers = createAvHandlers(n, () => clock)
    const ctx = {
      host: async () => '',
      emit: () => {},
    } as unknown as EngineContext
    const page = await handlers.list(ctx, 'new', 1, 'latest')
    expect(page).toMatchObject({ pageCount: 2, items: [{ code: 'abp-001' }] })
    await handlers.list(ctx, 'new', 1, 'latest')
    expect(calls).toBe(1)
    clock = 3 * 60 * 1000
    await handlers.list(ctx, 'new', 1, 'latest')
    expect(calls).toBe(2)
  })
})

describe('媒体 Referer 注入名单', () => {
  it('只给 surrit.com / fourhoi.com 的 https 请求注入', () => {
    expect(refererFor('https://surrit.com/a/playlist.m3u8')).toBe(
      'https://missav.ai/'
    )
    expect(refererFor('https://fourhoi.com/abp-001/cover-t.jpg')).toBe(
      'https://missav.ai/'
    )
    expect(refererFor('http://surrit.com/a')).toBeUndefined()
    expect(refererFor('https://surrit.com.evil.test/a')).toBeUndefined()
    expect(refererFor('not a url')).toBeUndefined()
  })
})
