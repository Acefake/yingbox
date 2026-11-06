import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_MIRRORS,
  DEFAULT_NETWORK,
  parseNetwork,
  tmdbCandidates,
} from '../src/shared/network/preferences'
import { fetchTmdb } from '../src/shared/network/tmdb-fetch'
import { createNetClient } from '../src/shared/net/client'
import { mirrorCandidates } from '../src/shared/release/mirrors'
import { probeNetwork } from '../src/shared/network/probe'

describe('网络优化', () => {
  it('拒绝携带凭据或指向本机的镜像', () => {
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://127.0.0.1',
      'https://foo.local',
    ])
      expect(
        parseNetwork({ ...DEFAULT_NETWORK, mirrors: [url] })
      ).toBeUndefined()
  })
  it('备用域名保持路径与查询，不改其他服务', () => {
    expect(
      tmdbCandidates(
        'https://api.themoviedb.org/3/tv/1?language=zh-CN',
        'alternate'
      )
    ).toEqual(['https://api.tmdb.org/3/tv/1?language=zh-CN'])
    expect(tmdbCandidates('https://image.tmdb.org/t/p/a.png', 'auto')).toEqual([
      'https://image.tmdb.org/t/p/a.png',
    ])
  })
  it('主 API 网络失败后使用备用 API', async () => {
    const seen: string[] = []
    const result = await fetchTmdb(
      'https://api.themoviedb.org/3/configuration',
      async url => {
        seen.push(url)
        if (seen.length === 1) throw new TypeError('network')
        return { status: 200 }
      }
    )
    expect(result.status).toBe(200)
    expect(seen[1]).toContain('api.tmdb.org')
  })
  it('鉴权和限流错误不切换端点', async () => {
    for (const status of [401, 403, 429]) {
      let calls = 0
      await fetchTmdb(
        'https://api.themoviedb.org/3/configuration',
        async () => {
          calls++
          return { status }
        }
      )
      expect(calls).toBe(1)
    }
  })

  it('读取当前配置，逐跳校验镜像，拦住解析到内网的候选', async () => {
    let mode: 'auto' | 'direct' = 'auto'
    const calls: string[] = []
    const net = createNetClient({
      network: () => ({
        ...DEFAULT_NETWORK,
        githubMode: mode,
        mirrors: ['https://internal.test/'],
      }),
      lookup: async host => [
        { address: host === 'internal.test' ? '10.0.0.1' : '93.184.216.34' },
      ],
      fetch: async url => {
        calls.push(url)
        return new Response('error', { status: 503 })
      },
    })
    await expect(
      net.open('https://raw.githubusercontent.com/o/r/main/a')
    ).rejects.toThrow('内网')
    expect(calls).toHaveLength(1)
    mode = 'direct'
    expect(
      (await net.open('https://raw.githubusercontent.com/o/r/main/a')).response
        .status
    ).toBe(503)
    expect(calls).toHaveLength(2)
  })

  it('携带鉴权的 GitHub 请求不送公共镜像，重定向跨源时清除敏感头', async () => {
    const calls: Array<{ url: string; auth: string | null }> = []
    const net = createNetClient({
      network: () => DEFAULT_NETWORK,
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (url, init) => {
        calls.push({
          url,
          auth: new Headers(init.headers).get('authorization'),
        })
        return calls.length === 1
          ? new Response('', {
              status: 302,
              headers: { Location: 'https://other.test/a' },
            })
          : new Response('error', { status: 503 })
      },
    })
    await net.open('https://api.github.com/repos/o/r', {
      headers: { Authorization: 'Bearer private' },
    })
    expect(calls).toEqual([
      { url: 'https://api.github.com/repos/o/r', auth: 'Bearer private' },
      { url: 'https://other.test/a', auth: null },
    ])
  })

  it('API 不使用只有文件能力的镜像，直连模式不增加候选', () => {
    const api = 'https://api.github.com/repos/o/r'
    expect(
      mirrorCandidates(api, {
        ...DEFAULT_NETWORK,
        mirrors: ['https://ghfast.top/'],
      })
    ).toEqual([api])
    expect(
      mirrorCandidates('https://github.com/o/r/a', {
        ...DEFAULT_NETWORK,
        githubMode: 'direct',
      })
    ).toEqual(['https://github.com/o/r/a'])
  })

  it('保存过早期内置镜像列表的配置跟随当前内置列表', () => {
    const legacy = {
      githubMode: 'auto' as const,
      tmdbMode: 'auto' as const,
      mirrors: [
        'https://gh-proxy.com/',
        'https://ghfast.top/',
        'https://ghproxy.net/',
      ],
    }
    expect(parseNetwork(legacy)?.mirrors).toEqual(BUILTIN_MIRRORS)
    // 用户自己增删过的列表保持原样
    const customized = { ...legacy, mirrors: ['https://ghfast.top/'] }
    expect(parseNetwork(customized)?.mirrors).toEqual(['https://ghfast.top/'])
    const extra = {
      ...legacy,
      mirrors: [...legacy.mirrors, 'https://mirror.test/'],
    }
    expect(parseNetwork(extra)?.mirrors).toEqual(extra.mirrors)
  })

  it('外部取消后不请求备用 TMDB', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => {
      controller.abort()
      throw new Error('cancelled')
    })
    await expect(
      fetchTmdb(
        'https://api.themoviedb.org/3/configuration',
        send,
        'auto',
        controller.signal
      )
    ).rejects.toThrow('cancelled')
    expect(send).toHaveBeenCalledOnce()
  })

  it('探测不把登录页 HTML 当作可用的 GitHub 文件或 API', async () => {
    const net = createNetClient({
      fetch: async () => new Response('<html>login</html>'),
      lookup: async () => [{ address: '93.184.216.34' }],
      network: () => ({
        ...DEFAULT_NETWORK,
        githubMode: 'direct',
        tmdbMode: 'direct',
      }),
    })
    const results = await probeNetwork(net, {
      ...DEFAULT_NETWORK,
      githubMode: 'direct',
    })
    expect(results.length).toBeGreaterThan(3)
    expect(results.every(result => !result.ok)).toBe(true)
  })
})
